import { describe, expect, it, vi } from 'vitest'

import * as compatibleSessionQueryTools from '../src/history-tools.js'

import apply, {
  Config,
  liveHandoffEngine,
  historyToolsPlugin,
} from '../src/index.js'

describe('plugin entry', () => {
  it('exports the base schema and mounts one engine plus the official history tools', () => {
    const plugin = vi.fn()

    apply({ plugin } as never, { thresholdRatio: 0.9 })

    expect(Config.dict?.maxTokens?.meta.volatile).toBe(true)
    expect(apply.Config).toBe(Config)
    expect(historyToolsPlugin).toBe(compatibleSessionQueryTools)
    expect(plugin).toHaveBeenCalledTimes(2)
    expect(plugin.mock.calls[0]?.[0]).toBe(liveHandoffEngine)
    const config = plugin.mock.calls[0]?.[1]
    expect(config.thresholdRatio).toBe(0.9)
    expect(config.maxTokens.get()).toBe(8192)
    expect(config.retainTokens.get()).toBeUndefined()
    expect(plugin).toHaveBeenNthCalledWith(2, compatibleSessionQueryTools, {})
  })

  it('lets a retention ratio replace only the implicit absolute default', () => {
    const plugin = vi.fn()
    apply({ plugin } as never, { retainRatio: 0.25 })
    expect(plugin.mock.calls[0]?.[1].retainRatio.get()).toBe(0.25)
    expect(plugin.mock.calls[0]?.[1].retainTokens.get()).toBeUndefined()
  })
})
