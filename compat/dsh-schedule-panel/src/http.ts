/**
 * HTTP 接口层 —— /dsh-schedule-panel/*（仅监听本机，DSH 默认回环绑定）。
 *
 *   GET  /dsh-schedule-panel/tasks          任务列表
 *   POST /dsh-schedule-panel/tasks          {action: add|remove|pause|resume|run, ...}
 *   GET  /dsh-schedule-panel/status         状态快照
 *   GET  /dsh-schedule-panel/tasks/:id/next  单次查询该任务下次触发时间
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { parseCron, formatNextRun, nextRun, CronParseError } from './cron'
import { type PanelRunState, type PanelStore, type PanelTask } from './store'
import { type TaskRunner } from './run'

const MAX_BODY_BYTES = 64 * 1024

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function respond(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/** 读取请求体（上限 64KB）。 */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  let tooLarge = false
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) { tooLarge = true; break }
    chunks.push(buffer)
  }
  if (tooLarge) {
    req.resume()
    throw new Error('请求内容过大（上限 64KB）')
  }
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null) throw new Error('请求内容格式错误，请重试')
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('请求内容格式错误，请重试')
    throw error
  }
}

export interface HttpRoutesOptions {
  store: PanelStore
  runner: TaskRunner
}

/** 注册 /dsh-schedule-panel/* 路由；返回 disposer。 */
export function registerHttpRoutes(ctx: Context, options: HttpRoutesOptions): () => void {
  const { store, runner } = options

  function nextRunSafe(cron: string): number | null {
    try {
      return nextRun(parseCron(cron), new Date())?.getTime() ?? null
    } catch {
      return null
    }
  }

  /** 任务视图（供客户端渲染）；把实时预览文本并入运行态。 */
  function taskView(task: PanelTask): unknown {
    const runState = store.runTracker.get(task.id)
    return {
      id: task.id,
      cron: task.cron,
      prompt: task.prompt,
      description: task.description,
      cwd: task.cwd,
      enabled: task.enabled,
      createdAt: task.createdAt,
      lastRunAt: task.lastRunAt,
      lastStatus: task.lastStatus,
      lastError: task.lastError,
      lastDurationMs: task.lastDurationMs,
      runCount: task.runCount,
      failCount: task.failCount,
      running: runner.isRunning(task.id),
      nextRunAt: nextRunSafe(task.cron),
      preview: runState ? runState.getPreview() : '',
    }
  }

  const handleTasks = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = (req.method ?? 'GET').toUpperCase()
    if (method === 'GET') {
      respond(res, 200, { ok: true, tasks: store.list().map(taskView) })
      return
    }
    if (method !== 'POST') {
      respond(res, 405, { ok: false, message: `不支持的请求方式（${method}）` })
      return
    }
    let body: Record<string, unknown>
    try {
      body = await readBody(req)
    } catch (error) {
      respond(res, 400, { ok: false, message: errorMessage(error) })
      return
    }
    const action = body.action
    try {
      if (action === 'add') {
        const cron = typeof body.cron === 'string' ? body.cron.trim() : ''
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
        if (cron === '' || prompt === '') {
          respond(res, 400, { ok: false, message: '触发时间与任务内容为必填项' })
          return
        }
        try {
          parseCron(cron)
        } catch (error) {
          respond(res, 400, { ok: false, message: cronErrorText(error) })
          return
        }
        const cwd = typeof body.cwd === 'string' && body.cwd.trim() !== '' ? body.cwd.trim() : undefined
        const description = typeof body.description === 'string' && body.description.trim() !== '' ? body.description.trim() : undefined
        const task = await store.add({
          cron,
          prompt,
          ...(cwd !== undefined ? { cwd } : {}),
          ...(description !== undefined ? { description } : {}),
        })
        respond(res, 200, { ok: true, message: `已添加任务 ${task.id}`, tasks: store.list().map(taskView) })
        return
      }
      const id = typeof body.id === 'string' ? body.id : ''
      if (id === '') {
        respond(res, 400, { ok: false, message: '缺少任务 id' })
        return
      }
      if (action === 'remove') {
        const removed = await store.remove(id)
        respond(res, removed ? 200 : 404, {
          ok: removed,
          message: removed ? `已删除任务 ${id}` : `任务不存在：${id}`,
          tasks: store.list().map(taskView),
        })
        return
      }
      if (action === 'pause' || action === 'resume') {
        const task = await store.setEnabled(id, action === 'resume')
        respond(res, task !== undefined ? 200 : 404, {
          ok: task !== undefined,
          message: task !== undefined ? `任务 ${id} 已${action === 'resume' ? '恢复' : '暂停'}` : `任务不存在：${id}`,
          tasks: store.list().map(taskView),
        })
        return
      }
      if (action === 'run') {
        const result = await runner.runTask(id)
        respond(res, result.ok ? 200 : 400, { ok: result.ok, message: result.message, tasks: store.list().map(taskView) })
        return
      }
      respond(res, 400, { ok: false, message: `不支持的操作：${String(action)}` })
    } catch (error) {
      respond(res, 400, { ok: false, message: errorMessage(error) })
    }
  }

  const handleStatus = (_req: IncomingMessage, res: ServerResponse): void => {
    const tasks = store.list()
    const running = runner.isRunning
    const runningCount = tasks.filter((t) => runner.isRunning(t.id)).length
    respond(res, 200, {
      ok: true,
      total: tasks.length,
      runningCount,
      enabledCount: tasks.filter((t) => t.enabled).length,
      tickSeconds: 30,
    })
  }

  const handleNext = (req: IncomingMessage, res: ServerResponse): void => {
    const idMatch = /^\/tasks\/([^/]+)(?:\/next)?$/.exec(req.url ?? '')
    if (!idMatch) { respond(res, 404, { ok: false, message: '未知路径' }); return }
    const id = decodeURIComponent(idMatch[1])
    const task = store.get(id)
    if (task === undefined) { respond(res, 404, { ok: false, message: `任务不存在：${id}` }); return }
    try {
      const next = nextRun(parseCron(task.cron), new Date())
      respond(res, 200, { ok: true, nextRunAt: next?.getTime() ?? null })
    } catch (error) {
      respond(res, 200, { ok: true, nextRunAt: null, error: cronErrorText(error) })
    }
  }

  const disposeTasks = ctx.webServer.register({ kind: 'exact', path: '/dsh-schedule-panel/tasks', handler: handleTasks })
  const disposeStatus = ctx.webServer.register({ kind: 'exact', path: '/dsh-schedule-panel/status', handler: handleStatus })
  const disposeNext = ctx.webServer.register({ kind: 'regex', path: /^\/dsh-schedule-panel\/tasks\/([^/]+)(?:\/next)?$/, handler: handleNext })
  return () => { disposeTasks(); disposeStatus(); disposeNext() }
}

function cronErrorText(error: unknown): string {
  if (error instanceof CronParseError) {
    return `时间格式无效：${error.message}。格式为 5 段（分 时 日 月 周），示例 0 9 * * * 表示每天 9 点`
  }
  return errorMessage(error)
}

export { taskView, cronErrorText, formatNextRun, CronParseError }
