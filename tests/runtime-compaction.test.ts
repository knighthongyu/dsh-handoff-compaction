import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  CallId,
  LlmAdapter,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'

import { HandoffCompactionEngine } from '../src/handoff-engine.js'
import { HANDOFF_HEADINGS, handoffInstruction } from '../src/handoff-prompt.js'
import { dshRequire } from './fixtures/sessions/runtime-helpers.js'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose()))
})

class SummaryAdapter extends LlmAdapter {
  constructor(
    private readonly chunks: readonly StreamChunk[],
    readonly calls: GenerateOptions[] = [],
  ) {
    super()
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model, context: { contextWindow: 100_000 } }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    yield* this.chunks
  }
}

class SequencedSummaryAdapter extends LlmAdapter {
  readonly calls: GenerateOptions[] = []

  constructor(private readonly responses: readonly (readonly StreamChunk[])[]) {
    super()
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model, context: { contextWindow: 100_000 } }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    yield* this.responses[this.calls.length - 1]!
  }
}

async function setup(adapter: LlmAdapter) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  const { default: TokenMeter } = await import(dshRequire.resolve('@deepseek-ai/dsh-token-meter'))
  await ctx.plugin(TokenMeter)
  ctx.llm.registerAdapter(['runtime'], adapter)
  await ctx.plugin(HandoffCompactionEngine, { auto: false, retainTokens: 100 })
  return ctx
}

function populateSession(ctx: Context, exactFact: string) {
  const session = ctx.sessions.create(SessionId('runtime-target'), { meta: { cwd: process.cwd() } })
  const callId = CallId('old-call')
  session.append('turn/start', { turn: 0 })
  session.append('step/start', { turn: 0, step: 0 })
  session.append('request/header', {
    header: { config: { provider: 'runtime', model: 'summary-model' } },
    reason: 'initial',
  })
  const oldPrompt = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `Investigate old result ${'A'.repeat(12_000)}` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const assistant = session.append('assistant/message', {
    turn: 0,
    step: 0,
    message: createAssistantMessage({
      content: [{ type: 'tool-call', id: callId, name: 'lookup', arguments: '{}' }],
      source: { provider: 'runtime', model: 'summary-model' },
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  session.append('tool/call', {
    turn: 0, step: 0, callId, name: 'lookup', arguments: '{}',
  })
  const toolResult = session.append('tool/result', {
    turn: 0,
    step: 0,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: `${exactFact}\n${'B'.repeat(12_000)}` }],
      isError: false,
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 0, step: 0 })
  session.append('turn/end', { turn: 0, reason: { kind: 'completed' } })

  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 0 })
  const recent = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'RECENT-TAIL-MUST-STAY' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1,
    step: 0,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'recent acknowledgement' }],
      source: { provider: 'runtime', model: 'summary-model' },
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  session.append('step/end', { turn: 1, step: 0 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  return { session, oldPrompt, assistant, toolResult, recent }
}

const handoffText = `# Context Handoff

## 1. Current Objective
- Continue runtime verification.

## 2. Current State
- Old lookup completed.

## 3. Key Decisions
(none)

## 4. Constraints
(none)

## 5. Exact Facts
- ORBIT fact is available through history search.

## 6. Files / Code
(none)

## 7. Failed Attempts / Problems
(none)

## 8. Pending Work
- Continue.

## 9. Next Step
- Read recent tail.

## 10. Historical References
- Search literal phrase ORBIT-NEBULA.
`

const allNoneHandoff = HANDOFF_HEADINGS.map((heading, index) => (
  index === 0 ? heading : `${heading}\n(none)`
)).join('\n\n')

describe('composed compaction runtime', () => {
  it('writes inherited checkpoint provenance while retaining the raw tail and source events', async () => {
    const adapter = new SummaryAdapter([
      { type: 'block-end', index: 0, block: { type: 'text', text: handoffText } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    const ctx = await setup(adapter)
    const { session, oldPrompt, assistant, toolResult, recent } = populateSession(ctx, 'ORBIT-NEBULA-7319')
    const originalToolEvent = structuredClone(session.events[toolResult.seq])
    const agent = { session, options: { provider: 'runtime', model: 'summary-model' } } as never

    const result = await (ctx.compaction as HandoffCompactionEngine).compactRegion(
      oldPrompt.seq,
      toolResult.seq,
      agent,
      new AbortController().signal,
    )

    expect(adapter.calls).toHaveLength(1)
    expect(JSON.stringify(adapter.calls[0]?.messages.slice(0, -1))).toContain(
      'RECENT-TAIL-MUST-STAY',
    )
    expect(adapter.calls[0]?.messages.at(-1)?.source).toMatchObject({
      kind: 'plugin', plugin: 'dsh-handoff-compaction',
    })
    expect(adapter.calls[0]?.messages.at(-1)?.content[0]).toMatchObject({
      type: 'text',
      text: handoffInstruction(3, { retainedMessageCount: 2, recovery: false }),
    })
    const summaryEvent = session.events[result.summarySeq] as any
    expect(summaryEvent.type).toBe('compaction/summary')
    expect(summaryEvent.data.shadowedSeqs).toEqual([oldPrompt.seq, assistant.seq, toolResult.seq])
    expect(summaryEvent.data.summary[0].text).toMatch(/^# Context Handoff/)
    const checkpoint = session.events.find((event: any) => (
      event.type === 'user/message' && event.sourceEventSeqs?.includes(result.summarySeq)
    )) as any
    expect(checkpoint.data.content.map((block: any) => block.text).join('\n')).toContain('<compacted-summary>')
    expect(checkpoint.data.content.map((block: any) => block.text).join('\n')).toContain('# Context Handoff')
    expect(checkpoint.sourceEventSeqs).toEqual(expect.arrayContaining([
      result.startSeq, result.summarySeq, oldPrompt.seq, assistant.seq, toolResult.seq,
    ]))
    expect(session.surface.nodes).toContain(recent.seq)
    expect(session.surface.nodes).not.toContain(toolResult.seq)
    expect(session.events[toolResult.seq]).toEqual(originalToolEvent)
    expect(ctx.get('toolResultPruner')).toBeUndefined()
    expect(session.events.some((event) => event.type.includes('prune'))).toBe(false)
  })

  it('keeps the selected surface unchanged when the summary is cancelled', async () => {
    const adapter = new SummaryAdapter([
      {
        type: 'finish',
        reason: { kind: 'aborted', failure: { message: 'cancelled by test', code: 'ABORTED' } },
      },
    ])
    const ctx = await setup(adapter)
    const { session, oldPrompt, toolResult } = populateSession(ctx, 'CANCEL-FACT')
    const before = [...session.surface.nodes]
    const agent = { session, options: { provider: 'runtime', model: 'summary-model' } } as never
    await expect((ctx.compaction as HandoffCompactionEngine).compactRegion(
      oldPrompt.seq, toolResult.seq, agent, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'ABORTED' })
    expect(session.surface.nodes).toEqual(before)
    expect(session.events.filter((event) => event.type === 'compaction/summary')).toHaveLength(0)
  })

  it('records one failed bracket after both all-none handoff attempts are rejected', async () => {
    const adapter = new SummaryAdapter([
      { type: 'block-end', index: 0, block: { type: 'text', text: allNoneHandoff } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    const ctx = await setup(adapter)
    const { session, oldPrompt, toolResult } = populateSession(ctx, 'EMPTY-HANDOFF-FACT')
    const beforeSurface = [...session.surface.nodes]
    const beforeEventCount = session.events.length
    const agent = { session, options: { provider: 'runtime', model: 'summary-model' } } as never

    await expect((ctx.compaction as HandoffCompactionEngine).compactRegion(
      oldPrompt.seq,
      toolResult.seq,
      agent,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'HANDOFF_ALL_SECTIONS_EMPTY' })

    const attemptEvents = session.events.slice(beforeEventCount) as any[]
    expect(adapter.calls).toHaveLength(2)
    expect(attemptEvents.map((event) => event.type)).toEqual([
      'compaction/start',
      'compaction/end',
    ])
    expect(JSON.stringify(attemptEvents[1]?.data.error)).toContain('HANDOFF_ALL_SECTIONS_EMPTY')
    expect(attemptEvents.some((event) => event.type === 'compaction/summary')).toBe(false)
    expect(attemptEvents.some((event) => event.surfaceOp?.op === 'replace')).toBe(false)
    expect(session.surface.nodes).toEqual(beforeSurface)
  })

  it('recovers from a tool-call response inside one real compaction transaction', async () => {
    const adapter = new SequencedSummaryAdapter([
      [
        {
          type: 'block-end',
          index: 0,
          block: { type: 'text', text: 'I will inspect the repository first.' },
        },
        {
          type: 'block-end',
          index: 1,
          block: {
            type: 'tool-call',
            id: CallId('summary-tool-call'),
            name: 'bash',
            arguments: '{"command":"pwd"}',
          },
        },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ],
      [
        { type: 'block-end', index: 0, block: { type: 'text', text: handoffText } },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
    ])
    const ctx = await setup(adapter)
    const { session, oldPrompt, toolResult } = populateSession(ctx, 'TOOL-CALL-RECOVERY-FACT')
    const beforeEventCount = session.events.length
    const agent = { session, options: { provider: 'runtime', model: 'summary-model' } } as never

    const result = await (ctx.compaction as HandoffCompactionEngine).compactRegion(
      oldPrompt.seq,
      toolResult.seq,
      agent,
      new AbortController().signal,
    )

    expect(adapter.calls).toHaveLength(2)
    expect(adapter.calls[0]?.messages.slice(0, -1)).toEqual(
      adapter.calls[1]?.messages.slice(0, -1),
    )
    const attemptEvents = session.events.slice(beforeEventCount) as any[]
    expect(attemptEvents.map((event) => event.type)).toEqual([
      'compaction/start',
      'compaction/summary',
      'user/message',
      'compaction/end',
    ])
    expect(attemptEvents[2]?.surfaceOp).toMatchObject({ op: 'replace' })
    expect(attemptEvents.filter((event) => event.type === 'compaction/summary')).toHaveLength(1)
    expect((session.events[result.summarySeq] as any).data.summary[0].text).toMatch(
      /^# Context Handoff/,
    )
  })
})
