/** The two public session event access shapes in supported DSH releases. */
export declare function currentSessionEvents<Event>(session: {
    readonly events?: readonly Event[];
    snapshotEvents?: () => readonly Event[];
}): readonly Event[];
//# sourceMappingURL=session-events.d.ts.map