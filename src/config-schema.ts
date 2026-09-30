import z from '@deepseek-ai/schemastery'
import { BasicCompactionEngine, type BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import type { LiveHandoffConfig } from './live-config.js'

/** Clone the base dictionary; never mutate the official engine's shared schema. */
export const Config = z.object({
  ...BasicCompactionEngine.Config.dict,
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8192).volatile(),
  retainTokens: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).volatile(),
  retainRatio: z.number().min(Number.MIN_VALUE).max(1).volatile(),
}) as z<BasicCompactionConfig, LiveHandoffConfig>
