import z from '@deepseek-ai/schemastery';
import { type BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic';
import type { LiveHandoffConfig } from './live-config.js';
/** Clone the base dictionary; never mutate the official engine's shared schema. */
export declare const Config: z<BasicCompactionConfig, LiveHandoffConfig>;
//# sourceMappingURL=config-schema.d.ts.map