export interface Budgets {
    maxTokens: number;
    retainTokens: number;
}
export interface BudgetValues {
    maxTokens?: number;
    retainTokens?: number;
    retainRatio?: number;
}
export type BudgetOperation = {
    op: 'set';
    path: string[];
    value: number;
} | {
    op: 'unset';
    path: string[];
};
export declare function readBudgets(value: BudgetValues): Budgets;
export declare function budgetOperations(summary: string, recent: string): BudgetOperation[];
//# sourceMappingURL=budget-form.d.ts.map