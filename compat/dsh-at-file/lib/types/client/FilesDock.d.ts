import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ObservableSnapshot } from './store.ts';
import type { AtFileSettings } from '../contract.ts';
export interface AtFileSettingsSnapshot {
    readonly value: AtFileSettings;
}
export type AtFileSettingsSource = ObservableSnapshot<AtFileSettingsSnapshot>;
export type AtFileIndexSource = ObservableSnapshot<readonly string[]>;
/** Injected business face: open one relative path, and the live settings source. */
export interface AtFileDockInjected {
    onOpen: (relative: string) => void;
    hooks: {
        scope: AtFileSettingsSource;
        index: AtFileIndexSource;
    };
}
/** Full dock entry props: InputZone owner share + session standard kit + injected face + locale seat. */
export type AtFileDockProps = PropsRuntime<'conversation.input.dock'> & InjectFace<AtFileDockInjected> & PropsLocale<'at-file'>;
/** One parsed mention token in the draft, with its span for precise removal. */
interface DraftMention {
    readonly relative: string;
    readonly start: number;
    readonly end: number;
}
/** Parse indexed @path tokens in order, deduplicating by relative path. */
export declare function draftMentions(draft: string, indexed: ReadonlySet<string>): readonly DraftMention[];
/** Draft text with one token span removed. */
export declare function withoutToken(draft: string, start: number, end: number): string;
/**
 * Render the referenced-path rows; null while the draft has no @path tokens or
 * the settings switch is off.
 * @param props - runtime (input currency + actions), inject, and locale shares.
 * @returns the dock strip, or null.
 */
export declare function FilesDock({ input, inputActions, onOpen, useScope, useIndex, t }: AtFileDockProps): import("react").JSX.Element | null;
export {};
