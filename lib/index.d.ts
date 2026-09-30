import type { Context } from '@deepseek-ai/cordis';
import { type BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic';
import * as compatibleSessionQueryTools from './history-tools.js';
import { Config } from './config-schema.js';
import { type LiveHandoffConfig } from './live-config.js';
export { HandoffCompactionEngine } from './handoff-engine.js';
export { HANDOFF_DEFAULTS, resolveHandoffConfig } from './config.js';
export { HANDOFF_HEADINGS, HANDOFF_INSTRUCTION, handoffInstruction, } from './handoff-prompt.js';
export { HandoffValidationError, validateHandoffText, type HandoffSourceFacts, type HandoffValidationCode, } from './handoff-validation.js';
export declare const name = "dsh-handoff-compaction";
export { Config };
export declare const historyToolsPlugin: typeof compatibleSessionQueryTools;
/** Mount exactly one compaction provider and the adapted official history-query tools. */
export declare function apply(ctx: Context, config?: LiveHandoffConfig | BasicCompactionConfig): void;
/** No child schema: references belong to the profile entry, not a nested provider. */
export declare const liveHandoffEngine: {
    name: string;
    inject: string[];
    apply(ctx: Context, config: LiveHandoffConfig): void;
};
declare const _default: typeof apply & {
    Config: import("@deepseek-ai/schemastery").default<BasicCompactionConfig, LiveHandoffConfig>;
};
export default _default;
//# sourceMappingURL=index.d.ts.map