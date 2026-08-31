import { describe, expect, it } from 'vitest'

import { HANDOFF_DEFAULTS, resolveHandoffConfig } from '../src/config.js'

describe('resolveHandoffConfig', () => {
  it('uses the approved V1 defaults', () => {
    expect(HANDOFF_DEFAULTS).toEqual({
      thresholdRatio: 0.8,
      retainTokens: 16000,
      maxTokens: 8192,
      compactionRetries: 1,
      maxOverflowRetries: 1,
      auto: true,
    })
    expect(resolveHandoffConfig()).toEqual(HANDOFF_DEFAULTS)
  })

  it('lets an explicit ratio replace the default absolute retention form', () => {
    expect(resolveHandoffConfig({ retainRatio: 0.2 })).toEqual({
      thresholdRatio: 0.8,
      retainRatio: 0.2,
      maxTokens: 8192,
      compactionRetries: 1,
      maxOverflowRetries: 1,
      auto: true,
    })
  })

  it('preserves explicit overrides and model policies', () => {
    const modelPolicies = [{ provider: 'local', model: 'large', maxTokens: 4096 }]
    expect(resolveHandoffConfig({
      thresholdRatio: 0.9,
      retainTokens: 8000,
      maxTokens: 4096,
      auto: false,
      modelPolicies,
    })).toMatchObject({
      thresholdRatio: 0.9,
      retainTokens: 8000,
      maxTokens: 4096,
      auto: false,
      modelPolicies,
    })
  })

  it('does not hide an explicitly invalid dual-retention input from base validation', () => {
    expect(resolveHandoffConfig({ retainRatio: 0.2, retainTokens: 8000 })).toMatchObject({
      retainRatio: 0.2,
      retainTokens: 8000,
    })
  })
})
