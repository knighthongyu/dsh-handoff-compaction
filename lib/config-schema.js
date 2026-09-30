import z from '@deepseek-ai/schemastery';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
/** Clone the base dictionary; never mutate the official engine's shared schema. */
export const Config = z.object({
    ...BasicCompactionEngine.Config.dict,
    maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8192).volatile(),
    retainTokens: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).volatile(),
    retainRatio: z.number().min(Number.MIN_VALUE).max(1).volatile(),
});
//# sourceMappingURL=config-schema.js.map