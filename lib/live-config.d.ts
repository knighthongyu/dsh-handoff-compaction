import type { BasicCompactionConfig, BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
/** Structural form of Cordis volatile references, shared by supported DSH versions. */
interface LiveNumber {
    get(): number | undefined;
}
export type LiveHandoffConfig = Omit<BasicCompactionConfig, 'maxTokens' | 'retainTokens' | 'retainRatio'> & {
    maxTokens: LiveNumber;
    retainTokens: LiveNumber;
    retainRatio: LiveNumber;
};
export declare function plainHandoffConfig(config: LiveHandoffConfig): BasicCompactionConfig;
/** Keep the existing engine and its listeners; every policy read gets a detached snapshot. */
export declare function bindLiveBudgets(engine: Pick<BasicCompactionEngine, 'config'>, config: LiveHandoffConfig): void;
export {};
//# sourceMappingURL=live-config.d.ts.map