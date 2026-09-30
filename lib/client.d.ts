import type { Context } from '@deepseek-ai/cordis';
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import { type BudgetValues } from './budget-form.js';
export declare const name = "handoff-budget-settings";
export declare const inject: string[];
declare const zh: {
    title: string;
    intro: string;
    summary: string;
    summaryHint: string;
    recent: string;
    recentHint: string;
    save: string;
    saving: string;
    reset: string;
    resetHint: string;
    saved: string;
    failed: string;
    invalid: string;
    loading: string;
    unavailable: string;
    readOnly: string;
    ratio: string;
    note: string;
};
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'handoff.budgets': keyof typeof zh;
    }
}
type T = (key: keyof typeof zh) => string;
interface Props {
    form: ConfigForm<BudgetValues>;
    t: T;
    view: 'page' | 'summary';
}
export declare function BudgetPanel({ form, t, view }: Props): import("react").DetailedReactHTMLElement<import("react").HTMLAttributes<HTMLElement>, HTMLElement> | import("react").DetailedReactHTMLElement<{
    className: string;
    onSubmit: (event: import("react").FormEvent<HTMLElement>) => void;
}, HTMLElement>;
export declare function apply(ctx: Context): void;
export {};
//# sourceMappingURL=client.d.ts.map