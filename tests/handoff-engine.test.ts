import { describe, expect, it } from 'vitest'

import type { Agent } from '@deepseek-ai/dsh-agent'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import {
  CallId,
  createUserMessage,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

import {
  HandoffCompactionEngine,
  type HandoffSummarizationInput,
} from '../src/handoff-engine.js'
import { HANDOFF_HEADINGS, handoffInstruction } from '../src/handoff-prompt.js'

const validHandoff = `# Context Handoff

## 1. Current Objective
- Ship it.

## 2. Current State
- Validation is active.

## 3. Key Decisions
(none)

## 4. Constraints
- Preserve one call.

## 5. Exact Facts
- Source messages exist.

## 6. Files / Code
(none)

## 7. Failed Attempts / Problems
(none)

## 8. Pending Work
(none)

## 9. Next Step
- Continue.

## 10. Historical References
(none)`

const allNoneHandoff = HANDOFF_HEADINGS.map((heading, index) => (
  index === 0 ? heading : `${heading}\n(none)`
)).join('\n\n')

class ExposedEngine extends HandoffCompactionEngine {
  runSummary(input: HandoffSummarizationInput, agent: Agent, signal?: AbortSignal) {
    const session = agent.session as Agent['session'] & { deriveMessages?: () => unknown[] }
    session.deriveMessages ??= () => [...input.messages]
    return this.summarize(input, agent, signal)
  }
}

function streamOf(...chunks: StreamChunk[]) {
  return async function* (_options: GenerateOptions) {
    yield* chunks
  }
}

function makeEngine(
  stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>,
  config: Record<string, unknown> = {},
  warnings: string[] = [],
) {
  const engine = Object.create(ExposedEngine.prototype) as ExposedEngine
  Object.defineProperty(engine, 'ctx', {
    value: {
      llm: { stream },
      logger: { warn: (message: string) => warnings.push(message) },
    },
  })
  Object.defineProperty(engine, 'config', {
    value: {
      thresholdRatio: 0.8,
      retainTokens: 16000,
      summarizationProvider: '',
      summarizationModel: '',
      maxTokens: 8192,
      compactionRetries: 1,
      maxOverflowRetries: 1,
      modelPolicies: [],
      auto: true,
      ...config,
    },
  })
  return engine
}

function sourceMessage(text = 'original context') {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

function fakeAgent(
  latest?: { provider: string; model: string },
  options: Record<string, unknown> = {},
  surfaceMessages?: readonly ReturnType<typeof sourceMessage>[],
) {
  return {
    session: {
      id: 'session-123',
      requestHeader: () => latest === undefined ? undefined : { config: latest },
      ...(surfaceMessages === undefined ? {} : { deriveMessages: () => [...surfaceMessages] }),
    },
    options,
  } as never
}

describe('HandoffCompactionEngine', () => {
  it('is a BasicCompactionEngine and sends one cache-aligned handoff request', async () => {
    const calls: GenerateOptions[] = []
    const signal = new AbortController().signal
    const usage = { inputTokens: 120, outputTokens: 40 }
    const stream = async function* (options: GenerateOptions) {
      calls.push(options)
      yield* streamOf(
        { type: 'block-start', index: 0, blockType: 'reasoning' },
        { type: 'reasoning-delta', index: 0, text: 'private thought' },
        { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'private thought' } },
        { type: 'block-start', index: 1, blockType: 'text' },
        { type: 'text-delta', index: 1, text: validHandoff },
        { type: 'block-end', index: 1, block: { type: 'text', text: validHandoff } },
        { type: 'usage', usage },
        { type: 'finish', reason: { kind: 'stop' } },
      )(options)
    }
    const engine = makeEngine(stream, {
      summarizationProvider: 'summary-provider',
      summarizationModel: 'summary-model',
      modelPolicies: [{ provider: 'chat-provider', model: 'chat-model', maxTokens: 4096 }],
    })
    const original = sourceMessage()
    const tools = [{ name: 'read', description: 'read data', parameters: { type: 'object' } }]

    expect(engine).toBeInstanceOf(BasicCompactionEngine)
    const result = await engine.runSummary(
      { system: 'system prompt', tools, messages: [original] },
      fakeAgent({ provider: 'chat-provider', model: 'chat-model' }),
      signal,
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      provider: 'summary-provider',
      model: 'summary-model',
      system: 'system prompt',
      tools,
      maxTokens: 4096,
      sessionId: 'session-123',
      purpose: 'compaction',
      signal,
    })
    expect(calls[0]?.messages.slice(0, -1)).toEqual([original])
    expect(calls[0]?.messages.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: handoffInstruction(1, false) }],
      source: { kind: 'plugin', plugin: 'dsh-handoff-compaction' },
    })
    expect(result).toEqual({
      summary: [{ type: 'text', text: validHandoff }],
      rawOutput: [
        { type: 'reasoning', text: 'private thought' },
        { type: 'text', text: validHandoff },
      ],
      llmStreamCall: true,
      provider: 'summary-provider',
      model: 'summary-model',
      maxTokens: 4096,
      usage,
    })
  })

  it('sends the complete current surface while limiting the summary source to the selected prefix', async () => {
    const calls: GenerateOptions[] = []
    const stream = async function* (options: GenerateOptions) {
      calls.push(options)
      yield { type: 'block-end', index: 0, block: { type: 'text', text: validHandoff } } as const
      yield { type: 'finish', reason: { kind: 'stop' } } as const
    }
    const engine = makeEngine(stream)
    const selected = sourceMessage('SELECTED-OLD-PREFIX')
    const retained = sourceMessage('RETAINED-RECENT-TAIL')

    await engine.runSummary(
      { messages: [selected] },
      fakeAgent({ provider: 'p', model: 'm' }, {}, [selected, retained]),
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]?.messages.slice(0, -1)).toEqual([selected, retained])
    expect(calls[0]?.messages.at(-1)?.content[0]).toMatchObject({
      type: 'text',
      text: handoffInstruction(1, { retainedMessageCount: 1, recovery: false }),
    })
  })

  it('fails before the provider call when the selected source is not the current surface prefix', async () => {
    let calls = 0
    const engine = makeEngine(async function* () {
      calls += 1
      yield { type: 'block-end', index: 0, block: { type: 'text', text: validHandoff } } as const
      yield { type: 'finish', reason: { kind: 'stop' } } as const
    })
    const selected = sourceMessage('SELECTED-OLD-PREFIX')
    const different = sourceMessage('DIFFERENT-CURRENT-PREFIX')

    await expect(engine.runSummary(
      { messages: [selected] },
      fakeAgent({ provider: 'p', model: 'm' }, {}, [different]),
    )).rejects.toMatchObject({ code: 'HANDOFF_SOURCE_MISMATCH' })
    expect(calls).toBe(0)
  })

  it('falls back from latest durable route to complete Agent options', async () => {
    const targets: Array<[string, string]> = []
    const stream = async function* (options: GenerateOptions) {
      targets.push([options.provider, options.model])
      yield { type: 'block-end', index: 0, block: { type: 'text', text: validHandoff } } as const
      yield { type: 'finish', reason: { kind: 'stop' } } as const
    }
    const engine = makeEngine(stream)

    await engine.runSummary({ messages: [sourceMessage()] }, fakeAgent({ provider: 'durable', model: 'latest' }))
    await engine.runSummary({ messages: [sourceMessage()] }, fakeAgent(undefined, { provider: 'agent', model: 'fallback' }))

    expect(targets).toEqual([['durable', 'latest'], ['agent', 'fallback']])
  })

  it('fails clearly when no complete provider/model route exists', async () => {
    const engine = makeEngine(streamOf())
    await expect(engine.runSummary(
      { messages: [sourceMessage()] },
      fakeAgent(undefined, { provider: 'incomplete' }),
    )).rejects.toThrow('no provider/model available for summarization')
  })

  it('fails closed on max-token truncation', async () => {
    const engine = makeEngine(streamOf(
      { type: 'block-end', index: 0, block: { type: 'text', text: 'partial' } },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ))
    await expect(engine.runSummary(
      { messages: [sourceMessage()] },
      fakeAgent({ provider: 'p', model: 'm' }),
    )).rejects.toMatchObject({ code: 'MAX_TOKENS' })
  })

  it('rejects image output and empty text projection', async () => {
    const imageEngine = makeEngine(streamOf(
      { type: 'block-end', index: 0, block: { type: 'image', attachment: {} as never } },
      { type: 'finish', reason: { kind: 'stop' } },
    ))
    await expect(imageEngine.runSummary(
      { messages: [sourceMessage()] },
      fakeAgent({ provider: 'p', model: 'm' }),
    )).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })

    const emptyEngine = makeEngine(streamOf(
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'thought' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ))
    await expect(emptyEngine.runSummary(
      { messages: [sourceMessage()] },
      fakeAgent({ provider: 'p', model: 'm' }),
    )).rejects.toThrow('summarization produced no text summary content')
  })

  it('rejects an empty replay source before calling the provider', async () => {
    let calls = 0
    const engine = makeEngine(async function* () {
      calls += 1
      yield { type: 'finish', reason: { kind: 'stop' } } as const
    })

    await expect(engine.runSummary(
      { messages: [] },
      fakeAgent({ provider: 'p', model: 'm' }),
    )).rejects.toMatchObject({ code: 'HANDOFF_SOURCE_EMPTY' })
    expect(calls).toBe(0)
  })

  it('recovers from an all-none result inside the transaction and clears recovery state', async () => {
    const calls: GenerateOptions[] = []
    const outputs = [allNoneHandoff, validHandoff, validHandoff]
    const stream = async function* (options: GenerateOptions) {
      calls.push(options)
      const text = outputs[calls.length - 1]!
      yield { type: 'block-end', index: 0, block: { type: 'text', text } } as const
      yield { type: 'finish', reason: { kind: 'stop' } } as const
    }
    const warnings: string[] = []
    const engine = makeEngine(stream, {}, warnings)
    const selected = sourceMessage('SECRET_SOURCE_TEXT')
    const retained = sourceMessage('RETAINED_RECOVERY_TAIL')
    const agent = fakeAgent({ provider: 'p', model: 'm' }, {}, [selected, retained])
    const input = { messages: [selected] }

    await expect(engine.runSummary(input, agent)).resolves.toMatchObject({
      summary: [{ type: 'text', text: validHandoff }],
    })
    await expect(engine.runSummary(input, agent)).resolves.toBeDefined()

    expect(calls).toHaveLength(3)
    expect(calls[0]?.messages.slice(0, -1)).toEqual([selected, retained])
    expect(calls[1]?.messages.slice(0, -1)).toEqual([selected, retained])
    const instructions = calls.map((call) => call.messages.at(-1)?.content[0])
    expect(instructions[0]).toMatchObject({
      type: 'text',
      text: handoffInstruction(1, { retainedMessageCount: 1, recovery: false }),
    })
    expect(instructions[1]).toMatchObject({
      type: 'text',
      text: handoffInstruction(1, { retainedMessageCount: 1, recovery: true }),
    })
    expect(instructions[2]).toMatchObject({
      type: 'text',
      text: handoffInstruction(1, { retainedMessageCount: 1, recovery: false }),
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('code=HANDOFF_ALL_SECTIONS_EMPTY')
    expect(warnings[0]).toContain('sourceMessages=1')
    expect(warnings[0]).toContain('provider=p')
    expect(warnings[0]).toContain('model=m')
    expect(warnings[0]).not.toContain('SECRET_SOURCE_TEXT')
  })

  it('recovers from tool-call output inside the same compaction transaction', async () => {
    const calls: GenerateOptions[] = []
    const stream = async function* (options: GenerateOptions) {
      calls.push(options)
      if (calls.length === 1) {
        yield {
          type: 'block-end',
          index: 0,
          block: { type: 'text', text: 'I will inspect the repository first.' },
        } as const
        yield {
          type: 'block-end',
          index: 1,
          block: {
            type: 'tool-call',
            id: CallId('call-summary-mistake'),
            name: 'bash',
            arguments: '{"command":"pwd"}',
          },
        } as const
        yield { type: 'finish', reason: { kind: 'tool-calls' } } as const
        return
      }

      yield { type: 'block-end', index: 0, block: { type: 'text', text: validHandoff } } as const
      yield { type: 'finish', reason: { kind: 'stop' } } as const
    }
    const warnings: string[] = []
    const engine = makeEngine(stream, {}, warnings)

    await expect(engine.runSummary(
      { messages: [sourceMessage('SOURCE-MUST-REMAIN-CACHE-ALIGNED')] },
      fakeAgent({ provider: 'p', model: 'm' }),
    )).resolves.toMatchObject({
      summary: [{ type: 'text', text: validHandoff }],
      rawOutput: [{ type: 'text', text: validHandoff }],
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.messages.slice(0, -1)).toEqual(calls[1]?.messages.slice(0, -1))
    expect(calls[0]?.messages.at(-1)?.content[0]).toMatchObject({
      type: 'text', text: handoffInstruction(1, false),
    })
    expect(calls[1]?.messages.at(-1)?.content[0]).toMatchObject({
      type: 'text', text: handoffInstruction(1, true),
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('code=HANDOFF_TOOL_CALL_OUTPUT')
    expect(warnings[0]).not.toContain('SOURCE-MUST-REMAIN-CACHE-ALIGNED')
  })
})
