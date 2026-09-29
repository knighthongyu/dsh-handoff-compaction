/**
 * 定时任务持久化存储 —— 内存镜像 + JSON 落盘（$DSH_HOME/schedule-panel.json）。
 *
 * 写入串行化：所有写操作排队到首轮文件加载之后执行，避免启动期“未读到旧
 * 任务就覆盖写盘”的数据丢失。读/解析失败时以空表继续（损坏文件保留原位以便排查）。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** 最小日志接口（由插件注入 ctx.logger）。 */
export interface PanelStoreLogger {
  warn(message: string, ...args: unknown[]): void
}

/** 持久化任务记录。 */
export interface PanelTask {
  readonly id: string
  /** 5 字段 cron 表达式。 */
  readonly cron: string
  /** 触发时交给 agent 执行的任务内容。 */
  readonly prompt: string
  /** 可选备注。 */
  readonly description?: string
  /** 任务工作目录（agent 的 cwd）；空 = 跟随默认。 */
  readonly cwd?: string
  readonly enabled: boolean
  readonly createdAt: number
  readonly lastRunAt?: number
  readonly lastStatus?: 'success' | 'error'
  readonly lastError?: string
  readonly lastDurationMs?: number
  readonly runCount: number
  readonly failCount: number
}

export interface PanelStoreOptions {
  /** $DSH_HOME 路径。 */
  home: string
  /** 可选的“运行中会话”追踪，供客户端实时预览。 */
  sessions?: PanelSessionTracker
  logger: PanelStoreLogger
}

/** 单次运行的运行时状态（供 HTTP 实时预览）。 */
export interface PanelRunState {
  readonly sessionId: string
  readonly startedAt: number
  /** 运行中会话的实时预览文本。 */
  getPreview(): string
  /** 订阅预览更新回调；返回处置函数。 */
  subscribe(listener: () => void): () => void
}

/** 运行状态追踪器：taskId → 运行状态。 */
export interface PanelSessionTracker {
  set(taskId: string, state: PanelRunState): void
  clear(taskId: string): void
  get(taskId: string): PanelRunState | undefined
}

export interface TaskDraft {
  readonly cron: string
  readonly prompt: string
  readonly description?: string
  readonly cwd?: string
}

function sanitize(raw: unknown): PanelTask[] {
  if (!Array.isArray(raw)) return []
  const tasks: PanelTask[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.cron !== 'string' || typeof record.prompt !== 'string') continue
    const lastStatus = record.lastStatus === 'success' || record.lastStatus === 'error'
      ? record.lastStatus
      : undefined
    tasks.push({
      id: record.id,
      cron: record.cron,
      prompt: record.prompt,
      ...(typeof record.description === 'string' && record.description !== '' ? { description: record.description } : {}),
      ...(typeof record.cwd === 'string' && record.cwd !== '' ? { cwd: record.cwd } : {}),
      enabled: record.enabled === true,
      createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
      ...(typeof record.lastRunAt === 'number' ? { lastRunAt: record.lastRunAt } : {}),
      ...(lastStatus !== undefined ? { lastStatus } : {}),
      ...(typeof record.lastError === 'string' ? { lastError: record.lastError } : {}),
      ...(typeof record.lastDurationMs === 'number' ? { lastDurationMs: record.lastDurationMs } : {}),
      runCount: typeof record.runCount === 'number' ? record.runCount : 0,
      failCount: typeof record.failCount === 'number' ? record.failCount : 0,
    })
  }
  return tasks
}

/** 定时任务存储：内存镜像 + 串行化 JSON 落盘。 */
export class PanelStore {
  private tasks = new Map<string, PanelTask>()
  private readonly path: string
  private readonly logger: PanelStoreLogger
  private readonly sessions: PanelSessionTracker
  private operationTail: Promise<void>

  constructor(options: PanelStoreOptions) {
    this.path = join(options.home, 'schedule-panel.json')
    this.logger = options.logger
    this.sessions = options.sessions ?? { set() {}, clear() {}, get() { return undefined } }
    // 写链首尾接上首轮加载：任何写操作都会等 load() 完成。
    this.operationTail = this.load()
  }

  private async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      for (const task of sanitize(raw)) this.tasks.set(task.id, task)
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined
      if (code !== 'ENOENT') {
        this.logger.warn('schedule-panel: 读取任务文件失败（%s）：%s', this.path, error instanceof Error ? error.message : String(error))
      }
    }
  }

  list(): readonly PanelTask[] {
    return [...this.tasks.values()].sort((a, b) => a.createdAt - b.createdAt)
  }

  get(id: string): PanelTask | undefined {
    return this.tasks.get(id)
  }

  /** 等待当前写链（含首轮文件加载）排空。 */
  flush(): Promise<void> {
    return this.operationTail
  }

  private async persist(): Promise<void> {
    const payload = JSON.stringify(this.list(), null, 2)
    await mkdir(dirname(this.path), { recursive: true })
    const temp = `${this.path}.tmp`
    await writeFile(temp, payload, 'utf8')
    await rename(temp, this.path)
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }

  add(draft: TaskDraft): Promise<PanelTask> {
    return this.enqueue(async () => {
      const task: PanelTask = {
        id: randomUUID(),
        ...draft,
        createdAt: Date.now(),
        enabled: true,
        runCount: 0,
        failCount: 0,
      }
      this.tasks.set(task.id, task)
      await this.persist()
      return task
    })
  }

  remove(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const removed = this.tasks.delete(id)
      if (removed) {
        this.sessions.clear(id)
        await this.persist()
      }
      return removed
    })
  }

  setEnabled(id: string, enabled: boolean): Promise<PanelTask | undefined> {
    return this.enqueue(async () => {
      const task = this.tasks.get(id)
      if (task === undefined) return undefined
      const next = { ...task, enabled }
      this.tasks.set(id, next)
      await this.persist()
      return next
    })
  }

  /** 记录一次运行结果（成功时清掉上次的失败原因）。 */
  recordRun(
    id: string,
    outcome: { status: 'success' | 'error'; error?: string; durationMs: number; runAt: number },
  ): Promise<PanelTask | undefined> {
    return this.enqueue(async () => {
      const task = this.tasks.get(id)
      if (task === undefined) return undefined
      const next: PanelTask = {
        ...task,
        lastRunAt: outcome.runAt,
        lastStatus: outcome.status,
        lastError: outcome.status === 'error' ? (outcome.error ?? '未知错误') : undefined,
        lastDurationMs: outcome.durationMs,
        runCount: task.runCount + 1,
        failCount: task.failCount + (outcome.status === 'error' ? 1 : 0),
      }
      this.tasks.set(id, next)
      await this.persist()
      return next
    })
  }

  /** 暴露运行追踪器（供 HTTP 实时预览）。 */
  get runTracker(): PanelSessionTracker {
    return this.sessions
  }
}
