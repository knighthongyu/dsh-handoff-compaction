import type { Context } from '@deepseek-ai/cordis'
import {
  BasicCompactionEngine,
  type BasicCompactionConfig,
} from '@deepseek-ai/dsh-compaction-basic'
import * as officialSessionQueryTools from '@deepseek-ai/dsh-tool-session-query'

import { resolveHandoffConfig } from './config.js'
import { HandoffCompactionEngine } from './handoff-engine.js'

export { HandoffCompactionEngine } from './handoff-engine.js'
export { HANDOFF_DEFAULTS, resolveHandoffConfig } from './config.js'
export {
  HANDOFF_HEADINGS,
  HANDOFF_INSTRUCTION,
  handoffInstruction,
} from './handoff-prompt.js'
export {
  HandoffValidationError,
  validateHandoffText,
  type HandoffSourceFacts,
  type HandoffValidationCode,
} from './handoff-validation.js'

export const name = 'dsh-handoff-compaction'
export const Config: typeof BasicCompactionEngine.Config = BasicCompactionEngine.Config
export const historyToolsPlugin = officialSessionQueryTools

/** Mount exactly one compaction provider and DSH's official history-query tools. */
export function apply(ctx: Context, config: BasicCompactionConfig = {}): void {
  ctx.plugin(HandoffCompactionEngine, resolveHandoffConfig(config))
  ctx.plugin(officialSessionQueryTools, {})
}

export default apply
