/**
 * Snapshot-store compatibility surface. Source builds against the split
 * 0.1.2 package; build.mjs rewrites that external to a runtime fallback that
 * uses client-runtime on 0.1.1.
 */
declare module '@deepseek-ai/dsh-client-store' {
    /** Runtime feature flag supplied by the compatibility bundle shim. */
    const usesSplitClientStore: boolean;
}
export { createSnapshotStore, usesSplitClientStore } from '@deepseek-ai/dsh-client-store';
export type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store';
