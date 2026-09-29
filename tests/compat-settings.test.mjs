import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const atFile = new URL('../compat/dsh-at-file/lib/index.js', import.meta.url)
const atFileClient = new URL('../compat/dsh-at-file/lib/client.js', import.meta.url)
const scheduleSource = new URL('../compat/dsh-schedule-panel/src/index.ts', import.meta.url)
const scheduleBundle = new URL('../compat/dsh-schedule-panel/lib/index.js', import.meta.url)

test('at-file uses DSH 0.1.7 entry settings instead of the removed namespace registry', async () => {
  const source = await readFile(atFile, 'utf8')
  assert.doesNotMatch(source, /ctx\.settings\.register\(/)
  assert.match(source, /enabled: dshSchema\.boolean\(\)\.default\(true\)\.volatile\(\)/)
  assert.match(source, /AT_FILE_NAMESPACE = "dsh-at-file"/)
  assert.match(source, /ctx\.settings\.update\(AT_FILE_NAMESPACE,/)
})

test('at-file strict Typert codecs expose the create factory required by DSH 0.1.7', async () => {
  for (const file of [atFile, atFileClient]) {
    const source = await readFile(file, 'utf8')
    const start = source.indexOf('var AT_FILE_INVOCATIONS = [')
    const manifest = source.slice(start, source.indexOf('\n];', start) + 3)
    assert.equal((manifest.match(/mode: "strict"/g) ?? []).length, 5)
    assert.equal((manifest.match(/create: \(\) => /g) ?? []).length, 5)
  }
})

test('schedule panel reads Loader Config rather than the removed settings.get API', async () => {
  for (const file of [scheduleSource, scheduleBundle]) {
    const source = await readFile(file, 'utf8')
    assert.doesNotMatch(source, /settings\??\.register\(/)
    assert.doesNotMatch(source, /settings\??\.get\(/)
    assert.match(source, /const rawTick = config\.tickSeconds/)
  }
})
