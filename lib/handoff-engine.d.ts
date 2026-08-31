import type { Agent } from '@deepseek-ai/dsh-agent';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { type ContentBlock, type Message, type TokenUsage, type ToolSchema } from '@deepseek-ai/dsh-llm';
export interface HandoffSummarizationInput {
    readonly system?: string;
    readonly tools?: readonly ToolSchema[];
    readonly messages: readonly Message[];
}
export type HandoffSummaryResult = {
    summary: ContentBlock[];
    rawOutput: ContentBlock[];
    llmStreamCall: true;
    provider: string;
    model: string;
    maxTokens: number;
    usage?: TokenUsage;
};
/** Basic DSH compaction lifecycle with a structured engineering-handoff summarizer. */
export declare class HandoffCompactionEngine extends BasicCompactionEngine {
    private recoverySessions?;
    private recoveryState;
    private summaryCallConfig;
    protected summarize(input: HandoffSummarizationInput, agent: Agent, signal?: AbortSignal): Promise<HandoffSummaryResult>;
}
export default HandoffCompactionEngine;
//# sourceMappingURL=handoff-engine.d.ts.map