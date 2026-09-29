/** The two public session event access shapes in supported DSH releases. */
export function currentSessionEvents<Event>(session: {
  readonly events?: readonly Event[]
  snapshotEvents?: () => readonly Event[]
}): readonly Event[] {
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  if (session.events !== undefined) return session.events
  throw new TypeError('DSH session exposes neither snapshotEvents() nor events')
}
