export type HandoffValidationCode = 'HANDOFF_SOURCE_EMPTY' | 'HANDOFF_TOOL_CALL_OUTPUT' | 'HANDOFF_STRUCTURE_INVALID' | 'HANDOFF_ALL_SECTIONS_EMPTY' | 'HANDOFF_WORKING_STATE_EMPTY';
export interface HandoffSourceFacts {
    readonly sourceMessageCount: number;
    readonly hasHumanUserMessage: boolean;
}
export declare class HandoffValidationError extends Error {
    readonly code: HandoffValidationCode;
    constructor(code: HandoffValidationCode, message: string);
}
/** Validate one generated handoff before DSH is allowed to commit its replacement event. */
export declare function validateHandoffText(markdown: string, facts: HandoffSourceFacts): void;
//# sourceMappingURL=handoff-validation.d.ts.map