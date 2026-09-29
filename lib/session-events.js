/** The two public session event access shapes in supported DSH releases. */
export function currentSessionEvents(session) {
    if (typeof session.snapshotEvents === 'function')
        return session.snapshotEvents();
    if (session.events !== undefined)
        return session.events;
    throw new TypeError('DSH session exposes neither snapshotEvents() nor events');
}
//# sourceMappingURL=session-events.js.map