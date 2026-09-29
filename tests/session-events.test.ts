import { describe, expect, it } from 'vitest'
import { currentSessionEvents } from '../src/session-events.js'

describe('current-session event compatibility', () => {
  const events = [{ type: 'step/start', seq: 4 }, { type: 'user/message', seq: 5 }]

  it('reads the DSH 0.1 event collection', () => {
    expect(currentSessionEvents({ events })).toBe(events)
  })

  it('reads a DSH 0.2 snapshot', () => {
    expect(currentSessionEvents({ snapshotEvents: () => events })).toBe(events)
  })
})
