import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import * as compatibleSessionQueryTools from './history-tools.js';
import { resolveHandoffConfig } from './config.js';
import { HandoffCompactionEngine } from './handoff-engine.js';
import { Config } from './config-schema.js';
import { bindLiveBudgets, plainHandoffConfig } from './live-config.js';
export { HandoffCompactionEngine } from './handoff-engine.js';
export { HANDOFF_DEFAULTS, resolveHandoffConfig } from './config.js';
export { HANDOFF_HEADINGS, HANDOFF_INSTRUCTION, handoffInstruction, } from './handoff-prompt.js';
export { HandoffValidationError, validateHandoffText, } from './handoff-validation.js';
export const name = 'dsh-handoff-compaction';
export { Config };
export const historyToolsPlugin = compatibleSessionQueryTools;
/** Mount exactly one compaction provider and the adapted official history-query tools. */
export function apply(ctx, config = {}) {
    const live = typeof config.maxTokens === 'object' ? config : Config(config);
    ctx.plugin(liveHandoffEngine, live);
    ctx.plugin(compatibleSessionQueryTools, {});
}
/** No child schema: references belong to the profile entry, not a nested provider. */
export const liveHandoffEngine = {
    name: 'handoff-engine',
    inject: BasicCompactionEngine.inject,
    apply(ctx, config) {
        const engine = new HandoffCompactionEngine(ctx, resolveHandoffConfig(plainHandoffConfig(config)));
        bindLiveBudgets(engine, config);
    },
};
// Loader resolves the default export; attach the schema to that callable too.
export default Object.assign(apply, { Config });
//# sourceMappingURL=index.js.map