import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic';
/** V1 defaults chosen for a late trigger and a useful verbatim working tail. */
export declare const HANDOFF_DEFAULTS: Readonly<{
    thresholdRatio: 0.8;
    retainTokens: 16000;
    maxTokens: 8192;
    compactionRetries: 1;
    maxOverflowRetries: 1;
    auto: true;
}>;
/**
 * Merge plugin defaults without masking the base engine's validation.
 *
 * A caller-selected ratio replaces only the implicit absolute-retention default.
 * If the caller explicitly supplies both retention forms, both are forwarded so
 * BasicCompactionEngine can reject the invalid configuration consistently.
 */
export declare function resolveHandoffConfig(config?: BasicCompactionConfig): BasicCompactionConfig;
//# sourceMappingURL=config.d.ts.map