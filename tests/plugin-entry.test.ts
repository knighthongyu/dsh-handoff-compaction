import { describe, expect, it, vi } from 'vitest'

import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import * as officialSessionQueryTools from '@deepseek-ai/dsh-tool-session-query'

import apply, {
  Config,
  HandoffCompactionEngine,
  historyToolsPlugin,
} from '../src/index.js'

describe('plugin entry', () => {
  it('exports the base schema and mounts one engine plus the official history tools', () => {
    const plugin = vi.fn()

    apply({ plugin } as never, { thresholdRatio: 0.9 })

    expect(Config).toBe(BasicCompactionEngine.Config)
    expect(historyToolsPlugin).toBe(officialSessionQueryTools)
    expect(plugin).toHaveBeenCalledTimes(2)
    expect(plugin).toHaveBeenNthCalledWith(1, HandoffCompactionEngine, {
      thresholdRatio: 0.9,
      retainTokens: 16000,
      maxTokens: 8192,
      compactionRetries: 1,
      maxOverflowRetries: 1,
      auto: true,
    })
    expect(plugin).toHaveBeenNthCalledWith(2, officialSessionQueryTools, {})
  })

  it('lets a retention ratio replace only the implicit absolute default', () => {
    const plugin = vi.fn()
    apply({ plugin } as never, { retainRatio: 0.25 })
    expect(plugin.mock.calls[0]?.[1]).toMatchObject({ retainRatio: 0.25 })
    expect(plugin.mock.calls[0]?.[1]).not.toHaveProperty('retainTokens')
  })
})
