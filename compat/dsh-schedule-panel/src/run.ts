/**
 * 任务执行器 —— host 侧。
 *
 * 职责：把一条任务交给一次性 agent 执行（校验 cwd 与模型路由 → create →
 * followup → 等待空闲（可超时）→ 会话落盘 → 注销），并把运行状态登记到
 * store 的 tracker 供客户端实时预览。同一任务不并发（runningTasks 同步登记）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { createUserMessage, type Message } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session'
import { cronMatches, parseCron, type CronSchedule } from './cron'
import { type PanelRunState, type PanelSessionTracker, type PanelStore, type PanelTask } from './store'

export interface RunConfig {
  /** 任务默认工作目录；空 = dsh 进程启动目录。 */
  readonly defaultCwd?: string
  /** 任务默认 provider；空 = agentDefaultModel.currentSelection()。 */
  readonly defaultProvider?: string
  /** 任务默认模型；空 = agentDefaultModel.currentSelection()。 */
  readonly defaultModel?: string
  /** 单次运行超时毫秒；0 = 不限时。 */
  readonly maxRunMs?: number
  /** 实时预览追踪器：把运行中 agent 的实时内容写回，供 HTTP 轮询。 */
  readonly liveTracker?: PanelSessionTracker
}

export interface RunResult {
  readonly ok: boolean
  readonly message: string
}

/** 从会话事件提取可显示文本；仅取 user/assistant/tool 等产生 Message 的事件。 */
function extractEventText(session: Session, event: SessionEvent): string {
  const msg: Message | null = session.deriveEventMessage(event)
  if (msg === null) return ''
  let text = ''
  for (const block of msg.content ?? []) {
    if (block.type === 'text') text += block.text
  }
  return text
}

const MAX_MESSAGE_LENGTH = 200

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 从会话日志的最后一个 turn/end 判定任务结果。 */
function describeOutcome(reason: TurnEndReason | undefined): { failed: boolean; text?: string } {
  if (reason === undefined) {
    return { failed: true, text: '任务未产生运行结果（可能被中断）' }
  }
  switch (reason.kind) {
    case 'completed':
      return { failed: false }
    case 'max-tokens':
      return { failed: true, text: '输出达到 token 上限，任务可能未完成' }
    case 'aborted':
      return { failed: true, text: '任务被中断' }
    case 'blocked':
      return { failed: true, text: '任务被阻止' }
    case 'error':
      return { failed: true, text: reason.error?.message ?? '运行出错' }
    case 'interrupted':
      return { failed: true, text: '运行被异常中断' }
    default:
      return { failed: true, text: '运行出错' }
  }
}

export interface TaskRunner {
  /** 立即运行一个任务；并发调用对同一任务互斥。 */
  runTask(id: string, schedule?: CronSchedule): Promise<RunResult>
  /** ticker 回调：扫描全部启用任务，命中当前分钟则触发。 */
  tick(now: Date): void
  /** 某个任务是否正在运行。 */
  isRunning(id: string): boolean
}

/** 创建任务执行器。 */
export function createTaskRunner(ctx: Context, store: PanelStore, config: RunConfig = {}): TaskRunner {
  const defaultCwd = (config.defaultCwd?.trim() ?? '') === '' ? process.cwd() : config.defaultCwd!
  const maxRunMs = config.maxRunMs ?? 30 * 60 * 1000
  // 实时预览追踪器；未提供时用空实现（同步清空不会抛错）。
  const liveTracker: PanelSessionTracker = config.liveTracker ?? {
    set() {},
    clear() {},
    get() { return undefined },
  }
  const runningTasks = new Set<string>()
  const lastTriggerMinute = new Map<string, string>()

  const minuteKey = (date: Date): string =>
    `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`

  const recordFailure = async (task: PanelTask, errorText: string, runAt: number, durationMs: number): Promise<void> => {
    try {
      await store.recordRun(task.id, { status: 'error', error: errorText, durationMs, runAt })
    } catch (persistError) {
      ctx.logger.warn('schedule-panel: 任务 %s 结果登记失败：%s', task.id, errorMessage(persistError))
    }
  }

  const runTask = async (id: string, precomputedSchedule?: CronSchedule): Promise<RunResult> => {
    const task = store.get(id)
    if (task === undefined) return { ok: false, message: `任务不存在：${id}` }
    if (runningTasks.has(id)) {
      return { ok: false, message: '该任务正在运行中，请等它结束后再试' }
    }
    runningTasks.add(id)
    const runAt = Date.now()
    try {
      let schedule = precomputedSchedule
      if (schedule === undefined) {
        try {
          schedule = parseCron(task.cron)
        } catch (error) {
          await recordFailure(task, `时间格式无效：${errorMessage(error)}`, runAt, 0)
          return { ok: false, message: `任务 ${shortId(id)} 的时间格式无效：${truncate(errorMessage(error))}` }
        }
      }

      const cwd = resolveCwd(task.cwd, defaultCwd)
      const info = await stat(cwd).catch(() => null)
      if (info === null || !info.isDirectory()) {
        await recordFailure(task, `工作目录不存在：${cwd}`, runAt, 0)
        return { ok: false, message: `任务 ${shortId(id)} 的工作目录不存在：${cwd}` }
      }

      const agents = ctx.get('agents')
      const sessions = ctx.get('sessions')
      if (agents === undefined || sessions === undefined) {
        const text = '运行环境未就绪'
        await recordFailure(task, text, runAt, 0)
        return { ok: false, message: `${text}：暂时无法执行任务，请重启 DSH 后重试` }
      }

      let provider: string | undefined = config.defaultProvider
      let model: string | undefined = config.defaultModel
      const needSelection = (provider?.trim() ?? '') === '' || (model?.trim() ?? '') === ''
      if (needSelection) {
        const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
        if (selection !== undefined) {
          if ((provider?.trim() ?? '') === '') provider = selection.provider
          if ((model?.trim() ?? '') === '') model = selection.model
        }
      }
      if ((provider?.trim() ?? '') === '' || (model?.trim() ?? '') === '') {
        const text = '未配置任务模型：请先在 DSH 的模型设置里选择一个模型，或请管理员在插件配置中设置默认模型后重试'
        await recordFailure(task, text, runAt, 0)
        return { ok: false, message: text }
      }

      await store.recordRun(id, { status: 'error', error: '运行中', durationMs: 0, runAt })
      ctx.logger.info('schedule-panel: 开始运行任务 %s（%s）', shortId(id), summarizePrompt(task.prompt))

      // 实时预览：订阅 agent 会话事件，累积助手/工具文本供 HTTP 轮询。
      let previewText = ''
      const previewListeners = new Set<() => void>()
      const runState: PanelRunState = {
        sessionId: `panel-${randomUUID()}`,
        startedAt: Date.now(),
        getPreview: () => previewText,
        subscribe: (listener: () => void) => {
          previewListeners.add(listener)
          return () => { previewListeners.delete(listener) }
        },
      }
      liveTracker.set(id, runState)

      const { agent, dispose } = await agents.create({
        sessionId: SessionId(runState.sessionId),
        meta: { cwd },
        agentOptions: { provider, model },
      })
      try {
        // 订阅前置：捕获用户消息之后的所有实时事件。
        const unsubscribe = agent.ctx.on('session/event', (session: Session, event: SessionEvent): void => {
          const text = extractEventText(session, event)
          if (text === '') return
          previewText += previewText === '' ? text : `\n${text}`
          for (const listener of previewListeners) {
            try {
              listener()
            } catch {
              // 单个订阅者抛错不影响其他预览更新。
            }
          }
        })
        agent.followup(createUserMessage({
          content: [{ type: 'text', text: task.prompt }],
          source: { kind: 'plugin', plugin: 'schedule-panel' },
        }))
        if (maxRunMs > 0) {
          const stopTimer = ctx.timeout(() => {
            ctx.logger.warn('schedule-panel: 任务 %s 超过 %dms，强制停止', shortId(id), maxRunMs)
            agent.cancel({ kind: 'hook', reason: 'schedule-panel run timeout' })
          }, maxRunMs)
          try {
            await agent.whenIdle()
          } finally {
            stopTimer()
          }
        } else {
          await agent.whenIdle()
        }
        // 停止预览更新后，从会话事件流解绑。
        unsubscribe()
        await sessions.flush(agent.session)
      } finally {
        await dispose().catch(() => undefined)
      }

      const events = agent.session.events
      let lastTurnEnd: { type: 'turn/end'; data: { turn: number; reason: TurnEndReason } } | undefined
      for (let i = events.length - 1; i >= 0; i -= 1) {
        if (events[i]!.type === 'turn/end') {
          lastTurnEnd = events[i] as { type: 'turn/end'; data: { turn: number; reason: TurnEndReason } }
          break
        }
      }
      const outcome = describeOutcome(lastTurnEnd?.data.reason)
      const durationMs = Date.now() - runAt
      await store.recordRun(id, {
        status: outcome.failed ? 'error' : 'success',
        ...(outcome.failed && outcome.text !== undefined ? { error: outcome.text } : {}),
        durationMs,
        runAt,
      })
      ctx.logger.info('schedule-panel: 任务 %s %s（%s）', shortId(id), outcome.failed ? '失败' : '完成', formatMs(durationMs))
      return outcome.failed
        ? { ok: false, message: `任务 ${shortId(id)} 运行失败（${formatMs(durationMs)}）：${truncate(outcome.text ?? '未知原因')}。完整原因见任务记录` }
        : { ok: true, message: `任务 ${shortId(id)} 运行完成（${formatMs(durationMs)}` }
    } catch (error) {
      const message = errorMessage(error)
      await recordFailure(task, message, runAt, Date.now() - runAt)
      ctx.logger.warn('schedule-panel: 任务 %s 异常：%s', shortId(id), message)
      return { ok: false, message: `任务 ${shortId(id)} 运行出错（${formatMs(Date.now() - runAt)}）：${truncate(message)}。请稍后重试或查看任务记录` }
    } finally {
      runningTasks.delete(id)
      store.runTracker.clear(id)
    }
  }

  const tick = (now: Date): void => {
    const key = minuteKey(now)
    for (const task of store.list()) {
      if (!task.enabled || runningTasks.has(task.id)) continue
      if (lastTriggerMinute.get(task.id) === key) continue
      let schedule: CronSchedule
      try {
        schedule = parseCron(task.cron)
      } catch {
        continue
      }
      if (!cronMatches(schedule, now)) continue
      lastTriggerMinute.set(task.id, key)
      void runTask(task.id, schedule).catch((error) => {
        ctx.logger.warn('schedule-panel: 任务 %s 触发失败：%s', task.id, errorMessage(error))
      })
    }
  }

  const isRunning = (id: string): boolean => runningTasks.has(id)

  return { runTask, tick, isRunning }
}

function summarizePrompt(prompt: string): string {
  const single = prompt.replace(/\s+/gu, ' ').trim()
  return single.length > 40 ? `${single.slice(0, 40)}…` : single
}

function resolveCwd(taskCwd: string | undefined, defaultCwd: string): string {
  return (taskCwd?.trim() ?? '') === '' ? defaultCwd : taskCwd!
}
