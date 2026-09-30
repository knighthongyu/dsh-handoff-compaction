import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createElement as h, useState, useSyncExternalStore } from 'react'
import { budgetOperations, readBudgets, type BudgetValues } from './budget-form.js'

export const name = 'handoff-budget-settings'
export const inject = ['slots', 'locale', 'configForms']
const NS = 'handoff.budgets'
const zh = {
  title: '上下文压缩',
  intro: '将较早的对话整理成交接摘要，保留近期原文。完整历史仍可搜索和读取。',
  summary: '交接摘要上限', summaryHint: '摘要最多生成多少 token，实际内容可能更短。默认 8192（8k）。',
  recent: '最近上下文预算', recentHint: '保留近期对话原文的 token 预算。完整消息和工具调用配对可能使实际保留量略超预算。默认 16000（16k）。',
  save: '保存', saving: '保存中…', reset: '恢复默认 8k + 16k',
  resetHint: '已填入默认值，点击“保存”生效。', saved: '已保存，后续压缩使用新预算。',
  failed: '保存未成功，配置可能已被其他页面修改。请重新打开本页后再试。',
  invalid: '摘要上限须为正整数；最近上下文预算须为非负整数。',
  loading: '正在读取配置…', unavailable: '插件未启用，暂时无法调整预算。', readOnly: '当前部署不允许保存配置。',
  ratio: '当前使用比例保留。保存此表单会改为固定 token 预算。',
  note: '两项预算不代表模型的全部输入大小；系统提示词和工具定义也会占用上下文。配置文件中的按模型预算会优先于这里的通用预算。',
}
const en: typeof zh = {
  title: 'Context compression',
  intro: 'Turn older conversations into structured handoffs while keeping recent messages verbatim. Full history remains searchable and readable.',
  summary: 'Handoff summary limit', summaryHint: 'Maximum tokens generated for the summary; the actual summary may be shorter. Default: 8192 (8k).',
  recent: 'Recent context budget', recentHint: 'Token budget for recent verbatim messages. Whole messages and paired tool calls may exceed it. Default: 16000 (16k).',
  save: 'Save', saving: 'Saving…', reset: 'Restore defaults: 8k + 16k',
  resetHint: 'Defaults filled in. Save to apply.', saved: 'Saved. Future compactions use these budgets.',
  failed: 'Save failed or configuration changed elsewhere. Reopen this page and try again.',
  invalid: 'The summary limit must be a positive integer; the recent context budget must be a nonnegative integer.',
  loading: 'Loading configuration…', unavailable: 'Enable this plugin to adjust its budgets.', readOnly: 'This deployment does not allow configuration writes.',
  ratio: 'Retention currently uses a ratio. Saving this form switches to a fixed token budget.',
  note: 'These budgets exclude system prompts and tool definitions. Model-specific budgets in the configuration file take precedence over these general budgets.',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'handoff.budgets': keyof typeof zh }
}
type T = (key: keyof typeof zh) => string
interface Draft { summary: string; recent: string; revision: number | undefined }
interface Props { form: ConfigForm<BudgetValues>; t: T; view: 'page' | 'summary' }

export function BudgetPanel({ form, t, view }: Props) {
  const state = useSyncExternalStore((listener) => form.subscribe(listener), () => form.getSnapshot())
  const [draft, setDraft] = useState<Draft>()
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<keyof typeof zh>()
  const accepted = readBudgets(state.value ?? {})
  const current = draft ?? { summary: String(accepted.maxTokens), recent: String(accepted.retainTokens), revision: state.revision }
  const disabled = pending || state.status !== 'ready' || !state.writable
  let invalid = false
  try { budgetOperations(current.summary, current.recent) } catch { invalid = true }
  if (view === 'summary') return h('span', null, t('intro'))
  const edit = (field: 'summary' | 'recent', text: string) => {
    setDraft({ ...current, [field]: text })
    setNotice(undefined)
  }
  const save = async () => {
    if (disabled || invalid) return
    setPending(true)
    setNotice(undefined)
    try {
      const ok = await form.mutate(budgetOperations(current.summary, current.recent), current.revision)
      if (ok) setDraft(undefined)
      setNotice(ok ? 'saved' : 'failed')
    } catch { setNotice('failed') } finally { setPending(false) }
  }
  const field = (key: 'summary' | 'recent', min: number) => h('div', { className: 'handoff-budget-field' },
    h('label', { htmlFor: `handoff-${key}` }, t(key)),
    h('div', { className: 'handoff-budget-input' },
      h('input', { id: `handoff-${key}`, type: 'number', min, step: 1, max: Number.MAX_SAFE_INTEGER,
        value: current[key], disabled, 'aria-describedby': `handoff-${key}-hint`, 'aria-invalid': invalid,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => edit(key, event.currentTarget.value) }),
      h('span', null, 'token')),
    h('p', { id: `handoff-${key}-hint` }, t(key === 'summary' ? 'summaryHint' : 'recentHint')))
  return h('form', { className: 'handoff-budgets', onSubmit: (event) => { event.preventDefault(); void save() } },
    h('style', null, CSS),
    h('p', { className: 'handoff-budget-intro' }, t('intro')),
    state.status !== 'ready' && h('p', { role: 'status' }, t(state.status === 'loading' ? 'loading' : 'unavailable')),
    state.status === 'ready' && !state.writable && h('p', { role: 'status' }, t('readOnly')),
    state.value?.retainRatio !== undefined && h('p', { className: 'handoff-budget-note' }, t('ratio')),
    h('div', { className: 'handoff-budget-grid' }, field('summary', 1), field('recent', 0)),
    h('p', { className: 'handoff-budget-note' }, t('note')),
    h('div', { className: 'handoff-budget-actions' },
      h('button', { type: 'submit', disabled: disabled || invalid || !draft, className: 'handoff-budget-save' }, t(pending ? 'saving' : 'save')),
      h('button', { type: 'button', disabled, onClick: () => {
        setDraft({ summary: '8192', recent: '16000', revision: state.revision })
        setNotice('resetHint')
      } }, t('reset'))),
    (notice || invalid) && h('p', { role: invalid || notice === 'failed' ? 'alert' : 'status', 'aria-live': 'polite' }, t(invalid ? 'invalid' : notice!)))
}

const CSS = `.handoff-budgets{max-width:720px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}.handoff-budget-intro{margin:0 0 24px;color:var(--dsw-alias-label-secondary)}.handoff-budget-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:24px}.handoff-budget-field label{display:block;font-weight:500;margin-bottom:8px}.handoff-budget-input{display:flex;align-items:center;gap:12px}.handoff-budget-input input{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l2,#aaa);border-radius:8px;background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;padding:8px 12px;font-variant-numeric:tabular-nums}.handoff-budget-input span,.handoff-budget-field p,.handoff-budget-note{color:var(--dsw-alias-label-tertiary);font-size:12px}.handoff-budget-field p{margin:8px 0 0}.handoff-budget-note{margin:20px 0}.handoff-budget-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}.handoff-budget-actions button{border:1px solid var(--dsw-alias-border-l2,#aaa);border-radius:8px;background:transparent;color:inherit;font:inherit;padding:7px 14px;cursor:pointer}.handoff-budget-actions .handoff-budget-save{background:var(--dsw-alias-label-primary,#222);color:var(--dsw-alias-label-primary-foreground,#fff)}.handoff-budgets :focus-visible{outline:2px solid var(--dsw-focus-ring-color,#3478f6);outline-offset:3px}.handoff-budgets :disabled{opacity:.5;cursor:default}.handoff-budgets [role=alert]{color:var(--dsw-alias-state-error-primary,#b33)}`

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  const form = ctx.configForms.get<BudgetValues>('handoff-compaction')
  const register = (slot: 'plugins.bundle.config' | 'plugins.row.config', key: string) =>
    ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, key, locale: NS },
      (props) => h(BudgetPanel, { form, t: props.t, view: props.view })))
  ctx.effect(() => register('plugins.bundle.config', 'dsh-handoff-compaction'))
  ctx.effect(() => register('plugins.row.config', 'dsh-handoff-compaction#handoff-compaction'))
}
