export function readBudgets(value) {
    return { maxTokens: value.maxTokens ?? 8192, retainTokens: value.retainTokens ?? 16000 };
}
export function budgetOperations(summary, recent) {
    const maxTokens = Number(summary);
    const retainTokens = Number(recent);
    if (summary.trim() === '' || recent.trim() === '' || !Number.isSafeInteger(maxTokens) || maxTokens < 1
        || !Number.isSafeInteger(retainTokens) || retainTokens < 0)
        throw new Error('INVALID_BUDGET');
    return [
        { op: 'set', path: ['maxTokens'], value: maxTokens },
        { op: 'unset', path: ['retainRatio'] },
        { op: 'set', path: ['retainTokens'], value: retainTokens },
    ];
}
//# sourceMappingURL=budget-form.js.map