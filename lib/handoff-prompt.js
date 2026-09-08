export const HANDOFF_HEADINGS = [
    '# Context Handoff',
    '## 1. Current Objective',
    '## 2. Current State',
    '## 3. Key Decisions',
    '## 4. Constraints',
    '## 5. Exact Facts',
    '## 6. Files / Code',
    '## 7. Failed Attempts / Problems',
    '## 8. Pending Work',
    '## 9. Next Step',
    '## 10. Historical References',
];
export const HANDOFF_INSTRUCTION = `You are writing an engineering handoff that will replace older conversation context while a recent raw tail remains available verbatim.

The conversation messages ABOVE are the complete current DSH context supplied to preserve provider prefix-cache alignment. The source manifest below divides them into leading messages that you must summarize and a trailing raw tail that DSH will retain verbatim. No separate replay document or attachment will be provided. A non-empty selected source must never produce an all-(none) handoff.

Return Markdown text only. Use every heading below exactly once, in this order, and do not add peer headings. Prefer terse, information-dense engineering bullets.

Preserve fidelity:
- Preserve exact paths, commands, errors, identifiers, versions, URLs, numerical values, and user corrections.
- Do not claim a command, test, edit, decision, result, or state unless the selected leading source messages above support it.
- Do not summarize or copy facts found only in the trailing raw tail; those messages remain available verbatim after compaction.
- Clearly distinguish completed work, current state, pending work, and proposed work.
- Remove superseded or stale state. Consolidate any previous <compacted-summary> into the newest supported state instead of copying it verbatim.
- Write "(none)" under any section with no supported content; never omit a section.

Respect the output budget:
- Target 4,000–6,000 tokens only when the source warrants that much detail.
- Do not pad the handoff. Be shorter whenever that preserves everything needed to resume correctly.
- Never exceed the provider generation cap of 8,192 tokens.
- Emit no reasoning blocks, tool calls, images, XML wrapper, or commentary outside the handoff.

Historical reference rules:
- Preserve exact session ids and event seq values only when they are already visible in the selected leading source messages above; never invent session ids or event seq values.
- When exact references are unavailable, provide concise literal search phrases plus the fact or decision each phrase should recover through the official session-history tools.

# Context Handoff

## 1. Current Objective

## 2. Current State

## 3. Key Decisions

## 4. Constraints

## 5. Exact Facts

## 6. Files / Code

## 7. Failed Attempts / Problems

## 8. Pending Work

## 9. Next Step

## 10. Historical References
`;
export function handoffInstruction(sourceMessageCount, recoveryOrOptions = false) {
    if (sourceMessageCount === undefined)
        return HANDOFF_INSTRUCTION;
    const recovery = typeof recoveryOrOptions === 'boolean'
        ? recoveryOrOptions
        : recoveryOrOptions.recovery ?? false;
    const retainedMessageCount = typeof recoveryOrOptions === 'boolean'
        ? 0
        : recoveryOrOptions.retainedMessageCount ?? 0;
    const recoveryWarning = recovery
        ? `
A previous handoff attempt incorrectly returned an invalid or all-(none) result. The selected leading source messages above contain substantive work. Extract concrete facts now and do not repeat that failure.
Do not call any tool even though tool schemas are present for prefix-cache compatibility. Tool calls cannot complete this task and will be rejected.
Your first output characters must be exactly "# Context Handoff". Output only the completed Markdown handoff.
`
        : '';
    const sourceManifest = `
Source manifest: summarize only the first ${sourceMessageCount} leading messages. The final ${retainedMessageCount} trailing messages are retained verbatim by DSH and are present only for prefix-cache alignment; do not summarize or copy them into the handoff.${recoveryWarning}
`;
    return HANDOFF_INSTRUCTION.replace('\n# Context Handoff', `${sourceManifest}\n# Context Handoff`);
}
//# sourceMappingURL=handoff-prompt.js.map