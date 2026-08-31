import { afterEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  createAssistantMessage,
  createUserMessage,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'

import apply, { HandoffCompactionEngine, historyToolsPlugin } from '../src/index.js'
import {
  dshRequire,
  outputText,
  requireFromDshBase,
} from './fixtures/sessions/runtime-helpers.js'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose()))
})

class HistorySummaryAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model, context: { contextWindow: 100_000 } }
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield {
      type: 'block-end',
      index: 0,
      block: {
        type: 'text',
        text: `# Context Handoff

## 1. Current Objective
- Verify history recovery.

## 2. Current State
- Old fact was compacted.

## 3. Key Decisions
(none)

## 4. Constraints
(none)

## 5. Exact Facts
- Recover the exact value with official history tools.

## 6. Files / Code
(none)

## 7. Failed Attempts / Problems
(none)

## 8. Pending Work
- Run search, read, and trace.

## 9. Next Step
- Query the shadowed event.

## 10. Historical References
- Search the literal ORBIT phrase.
`,
      },
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('official history retrieval runtime', () => {
  it('registers and executes all official query tools over live indexed history', async () => {
    const fixture = JSON.parse((await readFile(
      new URL('./fixtures/sessions/history.jsonl', import.meta.url),
      'utf8',
    )).trim()) as { exactFact: string }
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    const { default: TokenMeter } = await import(dshRequire.resolve('@deepseek-ai/dsh-token-meter'))
    await ctx.plugin(TokenMeter)
    ctx.llm.registerAdapter(['history-runtime'], new HistorySummaryAdapter())
    const { default: SqliteSessionQuery } = await import(requireFromDshBase('@deepseek-ai/dsh-session-query-sqlite'))
    await ctx.plugin(SqliteSessionQuery, { path: ':memory:', openAt: 'first-search' })
    apply(ctx, { auto: false, retainTokens: 100 })
    const engineRuntime = ctx.registry.get(HandoffCompactionEngine)
    const historyRuntime = ctx.registry.get(historyToolsPlugin)
    await Promise.all([
      ...Array.from(engineRuntime!.fibers, (fiber) => fiber.await()),
      ...Array.from(historyRuntime!.fibers, (fiber) => fiber.await()),
    ])

    const workspace = process.cwd()
    const target = ctx.sessions.create(SessionId('history-target'), { meta: { cwd: workspace } })
    target.append('turn/start', { turn: 0 })
    target.append('step/start', { turn: 0, step: 0 })
    target.append('request/header', {
      header: { config: { provider: 'history-runtime', model: 'summary-model' } },
      reason: 'initial',
    })
    const factEvent = target.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `${fixture.exactFact}\n${'H'.repeat(12_000)}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const oldAssistant = target.append('assistant/message', {
      turn: 0,
      step: 0,
      message: createAssistantMessage({
        content: [{ type: 'text', text: `old analysis ${'I'.repeat(12_000)}` }],
        source: { provider: 'history-runtime', model: 'summary-model' },
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [] })
    target.append('step/end', { turn: 0, step: 0 })
    target.append('turn/end', { turn: 0, reason: { kind: 'completed' } })
    target.append('turn/start', { turn: 1 })
    target.append('step/start', { turn: 1, step: 0 })
    const recent = target.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'HISTORY-RECENT-TAIL' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    target.append('step/end', { turn: 1, step: 0 })
    target.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    target.append('turn/start', { turn: 2 })

    const compaction = await (ctx.compaction as HandoffCompactionEngine).compactRegion(
      factEvent.seq,
      oldAssistant.seq,
      { session: target, options: { provider: 'history-runtime', model: 'summary-model' } } as never,
      new AbortController().signal,
    )
    const summaryEvent = target.events[compaction.summarySeq] as any
    expect(summaryEvent.data.shadowedSeqs).toEqual([factEvent.seq, oldAssistant.seq])
    expect(target.surface.nodes).toContain(recent.seq)
    expect(target.surface.nodes).not.toContain(factEvent.seq)
    const checkpoint = target.events.find((event: any) => (
      event.type === 'user/message' && event.sourceEventSeqs?.includes(compaction.summarySeq)
    ))!

    const caller = ctx.sessions.create(SessionId('history-caller'), { meta: { cwd: workspace } })
    const callerAgent = { session: caller, options: {} } as never
    const signal = new AbortController().signal
    const names = ctx.tools.schemas(callerAgent).map((schema) => schema.name)
    expect(names).toEqual(expect.arrayContaining([
      'session_search',
      'session_event_search',
      'session_trace',
      'session_event_trace',
      'session_event_read',
    ]))

    const search = await ctx.tools.execute({
      callId: CallId('history-search'),
      name: 'session_event_search',
      arguments: { session_id: target.id, query: fixture.exactFact },
      agent: callerAgent,
      signal,
    })
    expect(search.isError).toBe(false)
    expect(outputText(search)).toContain(fixture.exactFact)
    expect(outputText(search)).toContain(`seq ${factEvent.seq}`)

    const read = await ctx.tools.execute({
      callId: CallId('history-read'),
      name: 'session_event_read',
      arguments: { session_id: target.id, seq: factEvent.seq },
      agent: callerAgent,
      signal,
    })
    expect(read.isError).toBe(false)
    expect(outputText(read)).toContain(fixture.exactFact)

    const trace = await ctx.tools.execute({
      callId: CallId('history-trace'),
      name: 'session_event_trace',
      arguments: { session_id: target.id, seq: factEvent.seq },
      agent: callerAgent,
      signal,
    })
    expect(trace.isError).toBe(false)
    expect(outputText(trace)).toContain(`Replaced by: ${checkpoint.seq}`)
    expect(outputText(trace).toLowerCase()).toContain('replacement')

    const outside = ctx.sessions.create(SessionId('outside-caller'), { meta: { cwd: '/tmp/outside-workspace' } })
    const denied = await ctx.tools.execute({
      callId: CallId('history-denied'),
      name: 'session_event_read',
      arguments: { session_id: target.id, seq: factEvent.seq },
      agent: { session: outside, options: {} } as never,
      signal,
    })
    expect(denied.isError).toBe(true)
    expect(denied.error).toMatchObject({
      info: { code: 'SESSION_QUERY_TOOL_UNAUTHORIZED' },
    })
    expect(outputText(denied)).not.toContain(target.id)
  })
})
