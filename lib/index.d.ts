import type { Context } from '@deepseek-ai/cordis';
import { BasicCompactionEngine, type BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic';
import * as officialSessionQueryTools from '@deepseek-ai/dsh-tool-session-query';
export { HandoffCompactionEngine } from './handoff-engine.js';
export { HANDOFF_DEFAULTS, resolveHandoffConfig } from './config.js';
export { HANDOFF_HEADINGS, HANDOFF_INSTRUCTION, handoffInstruction, } from './handoff-prompt.js';
export { HandoffValidationError, validateHandoffText, type HandoffSourceFacts, type HandoffValidationCode, } from './handoff-validation.js';
export declare const name = "dsh-handoff-compaction";
export declare const Config: typeof BasicCompactionEngine.Config;
export declare const historyToolsPlugin: typeof officialSessionQueryTools;
/** Mount exactly one compaction provider and DSH's official history-query tools. */
export declare function apply(ctx: Context, config?: BasicCompactionConfig): void;
export default apply;
//# sourceMappingURL=index.d.ts.map