/**
 * dsh-schedule-panel —— host 半区。
 *
 * 功能：设置页图形界面选择触发时间、派发多个定时任务；到点自动在后台新建
 * Agent 会话执行，并在面板中查看结果。
 *
 * 命令组 /dsh-schedule-panel：
 *   /dsh-schedule-panel list                              任务列表
 *   /dsh-schedule-panel add <时间> <任务内容...>           新增（时间 5 段：分 时 日 月 周）
 *   /dsh-schedule-panel remove <id>                       删除
 *   /dsh-schedule-panel pause <id> | resume <id>          暂停 / 恢复
 *   /dsh-schedule-panel run <id>                          立即运行一次
 *
 * HTTP（设置页数据源，仅本机）：
 *   GET  /dsh-schedule-panel/tasks    任务列表
 *   POST /dsh-schedule-panel/tasks    {action: add|remove|pause|resume|run, ...}
 *   GET  /dsh-schedule-panel/status   状态快照
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { parseCron } from './cron'
import { PanelStore } from './store'
import { createTaskRunner } from './run'
import { registerHttpRoutes, cronErrorText } from './http'

export const name = 'schedule-panel'

/** 设置页卡片与 Host 命名空间的配对键（浏览器卡片 key 必须等于此值）。 */
export const SETTINGS_NAMESPACE = 'dsh-schedule-panel'

/** 宿主侧注入的服务。 */
export const inject = ['commands', 'webServer', 'timer']

export interface Config {
  readonly defaultCwd?: string
  readonly defaultProvider?: string
  readonly defaultModel?: string
  readonly tickSeconds?: number
  readonly maxRunMs?: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function tokens(rawInput: string): string[] {
  return rawInput.trim().split(/\s+/u).filter((token) => token.length > 0)
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index < 0 || index + 1 >= args.length) return undefined
  return args[index + 1]
}

/** 解析 /add 的 <时间>：支持裸 5 字段或引号包裹的整段。 */
function parseAddArgs(args: string[]): { cron: string; promptStart: number } | { error: string } {
  const first = args[1] ?? ''
  if (first.startsWith('"')) {
    let end = -1
    for (let i = 1; i < args.length; i += 1) {
      if (args[i]!.endsWith('"')) { end = i; break }
    }
    if (end < 0) return { error: '时间参数引号未闭合' }
    const cron = args.slice(1, end + 1).map((p) => p.replaceAll('"', '')).join(' ')
    try {
      parseCron(cron)
    } catch (error) {
      return { error: cronErrorText(error) }
    }
    return { cron, promptStart: end + 1 }
  }
  const cronFields = args.slice(1, 6)
  if (cronFields.length < 5) {
    return { error: `cron 需要 5 个字段（分 时 日 月 周），实际 ${cronFields.length} 个` }
  }
  const cron = cronFields.join(' ')
  try {
    parseCron(cron)
  } catch (error) {
    return { error: cronErrorText(error) }
  }
  return { cron, promptStart: 6 }
}

function parseCronSafe(cron: string): void {
  // 复用 http 里的 parseCron（需再导出），此处仅用于校验。
  import('./cron').then(({ parseCron }) => parseCron(cron))
}

function summarizePrompt(prompt: string): string {
  const single = prompt.replace(/\s+/gu, ' ').trim()
  return single.length > 40 ? `${single.slice(0, 40)}…` : single
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function apply(ctx: Context, config: Config = {}): void {
  // 实时预览：运行器把 agent 会话的实时内容写回 tracker，HTTP 轮询读取。
  const liveTracker: import('./store').PanelSessionTracker = {
    set() {},
    clear() {},
    get() { return undefined },
  }

  const store = new PanelStore({ home: resolveDshHome(), sessions: liveTracker, logger: ctx.logger })

  // DSH 0.1.7 使用 Loader entry config；本插件的任务卡片仍由 HTTP API 提供。
  const defaultCwd = config.defaultCwd ?? ''
  const defaultProvider = config.defaultProvider ?? ''
  const defaultModel = config.defaultModel ?? ''
  const rawTick = config.tickSeconds
  const tickSeconds = Number.isFinite(rawTick!) ? Math.max(5, Number(rawTick) ?? 30) : 30
  const maxRunMs = config.maxRunMs ?? 30 * 60 * 1000

  const runner = createTaskRunner(ctx, store, {
    defaultCwd,
    defaultProvider,
    defaultModel,
    maxRunMs,
    liveTracker,
  })

  const commandDisposers: Array<() => void> = []

  ctx.effect(() => {
    commandDisposers.push(ctx.commands.register({
      name: 'dsh-schedule-panel',
      description: '定时任务：到点自动执行（时间 5 段：分 时 日 月 周）；子命令 list/add/remove/pause/resume/run',
      input: { hint: 'list | add <时间(如 0 9 * * *)> <任务内容...> | remove <id> | pause <id> | resume <id> | run <id>' },
      handler: async (invocation) => {
        const args = tokens(invocation.rawInput)
        const sub = args[0] ?? ''
        try {
          if (sub === '' || sub === 'list') {
            const tasks = store.list()
            if (tasks.length === 0) {
              return { kind: 'success', text: '定时任务：无\n添加示例：/dsh-schedule-panel add 0 9 * * * 每天 9 点总结进展（0 9 * * * = 每天 9 点）' }
            }
            return { kind: 'success', text: `定时任务（${tasks.length}）：\n${tasks.map(formatTaskLine).join('\n')}` }
          }
          if (sub === 'add') {
            if (args.length < 2) {
              return { kind: 'error', text: '用法：/dsh-schedule-panel add <时间> <任务内容...>\n时间格式：5 段（分 时 日 月 周），如 0 9 * * * = 每天 9 点' }
            }
            const parsed = parseAddArgs(args)
            if ('error' in parsed) return { kind: 'error', text: parsed.error }
            const prompt = args.slice(parsed.promptStart).join(' ').trim()
            if (prompt === '') return { kind: 'error', text: '缺少任务内容' }
            const task = await store.add({ cron: parsed.cron, prompt })
            return { kind: 'success', text: `已添加任务 ${task.id}\n${formatTaskLine(task)}` }
          }
          if (sub === 'remove') {
            const removed = await store.remove(args[1] ?? '')
            return { kind: 'success', text: removed ? `已删除任务：${args[1]}` : `任务不存在：${args[1]}` }
          }
          if (sub === 'pause' || sub === 'resume') {
            const task = await store.setEnabled(args[1] ?? '', sub === 'resume')
            return task === undefined
              ? { kind: 'error', text: `任务不存在：${args[1]}` }
              : { kind: 'success', text: `任务 ${args[1]} 已${sub === 'resume' ? '恢复' : '暂停'}` }
          }
          if (sub === 'run') {
            const result = await runner.runTask(args[1] ?? '')
            return result.ok
              ? { kind: 'success', text: result.message }
              : { kind: 'error', text: result.message }
          }
          return { kind: 'error', text: `未知子命令：${sub}\n用法：/dsh-schedule-panel [list|add <时间> <任务内容...>|remove <id>|pause <id>|resume <id>|run <id>]` }
        } catch (error) {
          return { kind: 'error', text: errorMessage(error) }
        }
      },
    }))
    commandDisposers.push(registerHttpRoutes(ctx, { store, runner }))
    commandDisposers.push(ctx.interval(() => runner.tick(new Date()), tickSeconds * 1000))
    return () => {
      for (const dispose of commandDisposers) dispose()
      commandDisposers.length = 0
    }
  }, 'schedule-panel: app')

  ctx.logger.info('schedule-panel: 定时任务已启用（tick %ds）', tickSeconds)
}

function formatTaskLine(task: { id: string; cron: string; prompt: string; description?: string; cwd?: string; enabled: boolean; lastStatus?: string; lastError?: string; lastDurationMs?: number; runCount: number; failCount: number }): string {
  let status: string
  if (!task.enabled) status = '暂停'
  else if (task.lastStatus === 'error') status = `上次失败（${task.lastError ?? '未知原因'}）`
  else if (task.lastStatus === 'success') status = `上次成功（${formatMs(task.lastDurationMs ?? 0)}）`
  else status = '待触发'
  const lines = [`  ${task.id.slice(0, 8)}  ${task.cron}  ${status}`]
  lines.push(`     ${summarizePrompt(task.prompt)}`)
  if (task.description !== undefined) lines.push(`     ${task.description}`)
  return lines.join('\n')
}
