import assert from 'node:assert/strict'
import test from 'node:test'

import { inject } from '../lib/index.js'

test('schedule panel declares timer before using ctx.interval', () => {
  assert.ok(inject.includes('timer'), 'schedule-panel must inject timer before using ctx.interval')
})
