import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.js'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { resolveHandoffConfig } from '../src/config.js'
import { readBudgets, budgetOperations } from '../src/budget-form.js'
import { plainHandoffConfig, bindLiveBudgets } from '../src/live-config.js'
import { dshRequire } from './fixtures/sessions/runtime-helpers.js'

describe('visual context budgets', () => {
  it('exposes native live fields while preserving defaults and ratio-only configuration', () => {
    expect(BasicCompactionEngine.Config.dict?.maxTokens?.meta.volatile).not.toBe(true)
    const parsed = Config({ retainRatio: 0.25 })
    expect(parsed.maxTokens.get()).toBe(8192)
    expect(parsed.retainTokens.get()).toBeUndefined()
    expect(resolveHandoffConfig(plainHandoffConfig(parsed))).toMatchObject({ retainRatio: 0.25 })
    expect(resolveHandoffConfig(plainHandoffConfig(parsed))).not.toHaveProperty('retainTokens')
  })

  it('rejects invalid token budgets at the native schema boundary', () => {
    for (const maxTokens of [0, -1, 1.5, Infinity]) expect(() => Config({ maxTokens })).toThrow()
    for (const retainTokens of [-1, 1.5, Infinity]) expect(() => Config({ retainTokens })).toThrow()
    expect(Config({ retainTokens: 0 }).retainTokens.get()).toBe(0)
  })

  it('feeds next engine operations without replacing the provider or model overrides', async () => {
    const { updateVolatile } = await import(dshRequire.resolve('@deepseek-ai/cosmokit'))
    const parsed = Config({ maxTokens: 8192, retainTokens: 16000 })
    const modelPolicies = [{ provider: 'local', model: 'tiny', maxTokens: 1024 }]
    const engine = { config: Object.freeze({ ...resolveHandoffConfig(), modelPolicies }) }
    bindLiveBudgets(engine as never, parsed)
    const captured = engine.config
    const next = Config({ maxTokens: 4096, retainTokens: 8000 })
    updateVolatile(parsed.maxTokens, next.maxTokens)
    updateVolatile(parsed.retainTokens, next.retainTokens)
    expect(engine.config).toMatchObject({ maxTokens: 4096, retainTokens: 8000, modelPolicies })
    expect(captured).toMatchObject({ maxTokens: 8192, retainTokens: 16000 })
  })

  it('validates the draft and atomically switches ratio retention to absolute tokens', () => {
    expect(budgetOperations('4096', '8000')).toEqual([
      { op: 'set', path: ['maxTokens'], value: 4096 },
      { op: 'unset', path: ['retainRatio'] },
      { op: 'set', path: ['retainTokens'], value: 8000 },
    ])
    for (const text of ['', '-1', '1.5', 'abc', 'Infinity', '9007199254740992']) {
      expect(() => budgetOperations(text, '8000')).toThrow()
    }
    expect(() => budgetOperations('4096', '0')).not.toThrow()
    expect(() => budgetOperations('0', '8000')).toThrow()
    expect(readBudgets({})).toEqual({ maxTokens: 8192, retainTokens: 16000 })
  })
})
