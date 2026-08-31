import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { importFromDsh } from './fixtures/sessions/runtime-helpers.js'

const fixturePath = fileURLToPath(new URL('./fixtures/headless-base.yml', import.meta.url))
const patchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))

interface Entry {
  id?: string
  name?: string
  disabled?: boolean
  config?: unknown
}

interface Patch extends Entry {
  insert?: Entry[]
}

type EntryList = Entry[]
type PatchLayer = Patch[]

const { composeEntries, loadOverlayPatches } = (await importFromDsh('@deepseek-ai/dsh-app-boot')) as {
  composeEntries(layers: readonly PatchLayer[], warn?: (message: string) => void): EntryList
  loadOverlayPatches(binName: string, file: string): PatchLayer
}

function loadLayers(): { stockLayer: PatchLayer; patchLayer: PatchLayer } {
  return {
    stockLayer: loadOverlayPatches('test', fixturePath),
    patchLayer: loadOverlayPatches('test', patchPath),
  }
}

function byId(entries: EntryList, id: string): Entry {
  const entry = entries.find((candidate) => candidate.id === id)
  if (entry === undefined) throw new Error(`missing entry: ${id}`)
  return entry
}

describe('headless Bundle patch', () => {
  it('anchors the fixture to the installed stock behavior', () => {
    const { stockLayer } = loadLayers()
    const stock = composeEntries([stockLayer])
    expect(byId(stock, 'compaction-basic').disabled).not.toBe(true)
    expect(byId(stock, 'tool-result-pruner').disabled).not.toBe(true)
    expect(byId(stock, 'session-query-sqlite').config).toEqual({
      path: ':memory:',
      openAt: 'never',
    })
    expect(byId(stock, 'command-compact').name).toBe('@deepseek-ai/dsh-command-compact')
  })

  it('replaces the compactor, disables pruning, and enables persistent search', () => {
    const { stockLayer, patchLayer } = loadLayers()
    const stock = composeEntries([stockLayer])
    const warnings: string[] = []
    const patched = composeEntries([stockLayer, patchLayer], (message) => warnings.push(message))

    expect(warnings).toEqual([])
    expect(byId(patched, 'compaction-basic').disabled).toBe(true)
    expect(byId(patched, 'tool-result-pruner').disabled).toBe(true)
    expect(byId(patched, 'command-compact')).toEqual(byId(stock, 'command-compact'))

    const handoff = byId(patched, 'handoff-compaction')
    expect(handoff.name).toBe('dsh-handoff-compaction')
    expect(handoff.config).toEqual({
      thresholdRatio: 0.8,
      retainTokens: 16000,
      maxTokens: 8192,
      compactionRetries: 1,
      maxOverflowRetries: 1,
      auto: true,
    })
    const activeCompactors = ['compaction-basic', 'handoff-compaction']
      .map((id) => byId(patched, id))
      .filter((entry) => entry.disabled !== true)
    expect(activeCompactors).toHaveLength(1)
    expect(activeCompactors[0]?.id).toBe('handoff-compaction')

    const sqlite = byId(patched, 'session-query-sqlite')
    expect(sqlite.config).toMatchObject({
      path: { __jsExpr: "dshHomePath('session-query.sqlite')" },
      openAt: 'first-search',
    })
  })

  it('surfaces a skipped target warning instead of silently patching the wrong tree', () => {
    const { stockLayer, patchLayer } = loadLayers()
    const stock = composeEntries([stockLayer]).filter((entry) => entry.id !== 'compaction-basic')
    const warnings: string[] = []
    composeEntries(
      [[{ insert: stock }], patchLayer],
      (message) => warnings.push(message),
    )
    expect(warnings.some((warning) => warning.includes('compaction-basic'))).toBe(true)
  })
})
