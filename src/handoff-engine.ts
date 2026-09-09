import type { Agent } from '@deepseek-ai/dsh-agent'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { isDeepStrictEqual } from 'node:util'
import {
  BlockAssembler,
  LlmError,
  contentHasImage,
  createUserMessage,
  type ContentBlock,
  type FinishReason,
  type LlmCallConfig,
  type Message,
  type TokenUsage,
  type ToolSchema,
} from '@deepseek-ai/dsh-llm'

import { handoffInstruction } from './handoff-prompt.js'
import {
  HandoffValidationError,
  validateHandoffText,
} from './handoff-validation.js'

export interface HandoffSummarizationInput {
  readonly system?: string
  readonly tools?: readonly ToolSchema[]
  readonly messages: readonly Message[]
}

export type HandoffSummaryResult = {
  summary: ContentBlock[]
  rawOutput: ContentBlock[]
  llmStreamCall: true
  provider: string
  model: string
  maxTokens: number
  usage?: TokenUsage
}

interface SummaryCallConfig {
  readonly summarizationProvider: string
  readonly summarizationModel: string
  readonly maxTokens: number
}

interface Route {
  readonly provider: string
  readonly model: string
}

type CacheAlignment = 'same-route' | 'different-route' | 'no-durable-header'

interface ReusableRequestControls {
  readonly reasoningEffort?: NonNullable<LlmCallConfig['reasoningEffort']>
  readonly temperature?: number
  readonly stop?: string[]
}

const MAX_HANDOFF_ATTEMPTS = 2

function completeAgentRoute(agent: Agent): Route | undefined {
  const { provider, model } = agent.options
  if (provider === undefined || provider.length === 0 || model === undefined || model.length === 0) {
    return undefined
  }
  return { provider, model }
}

function latestDurableCallConfig(agent: Agent): LlmCallConfig | undefined {
  const config = agent.session.requestHeader()?.config
  if (config === undefined || config.provider.length === 0 || config.model.length === 0) {
    return undefined
  }
  return config
}

function latestDurableRoute(agent: Agent): Route | undefined {
  const config = latestDurableCallConfig(agent)
  return config === undefined ? undefined : { provider: config.provider, model: config.model }
}

function routeEquals(left: Route, right: Route): boolean {
  return left.provider === right.provider && left.model === right.model
}

function reusableRequestControls(
  durable: LlmCallConfig | undefined,
  target: Route,
): { alignment: CacheAlignment, controls: ReusableRequestControls } {
  if (durable === undefined) {
    return { alignment: 'no-durable-header', controls: {} }
  }
  if (!routeEquals(durable, target)) {
    return { alignment: 'different-route', controls: {} }
  }
  return {
    alignment: 'same-route',
    controls: {
      ...(durable.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: durable.reasoningEffort }),
      ...(durable.temperature === undefined ? {} : { temperature: durable.temperature }),
      ...(durable.stop === undefined ? {} : { stop: [...durable.stop] }),
    },
  }
}

function requestControlDiagnostics(
  alignment: CacheAlignment,
  controls: ReusableRequestControls,
): string {
  return `cacheAlignment=${alignment} reasoningEffort=${controls.reasoningEffort ?? 'provider-default'} temperature=${controls.temperature ?? 'provider-default'} stopCount=${controls.stop?.length ?? 0}`
}

function finishError(finish: FinishReason): (Error & { code?: string }) | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted': {
      const error: Error & { code?: string } = new Error(finish.failure.message)
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens': {
      const error: Error & { code?: string } = new Error(
        'summarization truncated at the token cap (incomplete checkpoint)',
      )
      error.code = 'MAX_TOKENS'
      return error
    }
    default:
      return undefined
  }
}

/** Basic DSH compaction lifecycle with a structured engineering-handoff summarizer. */
export class HandoffCompactionEngine extends BasicCompactionEngine {
  private recoverySessions?: WeakSet<object>

  private recoveryState(): WeakSet<object> {
    this.recoverySessions ??= new WeakSet<object>()
    return this.recoverySessions
  }

  private summaryCallConfig(agent: Agent): SummaryCallConfig {
    const conversationRoute = latestDurableRoute(agent) ?? completeAgentRoute(agent)
    const override = conversationRoute === undefined
      ? undefined
      : this.config.modelPolicies.find((policy) => (
          policy.provider === conversationRoute.provider && policy.model === conversationRoute.model
        ))

    return {
      summarizationProvider: override?.summarizationProvider ?? this.config.summarizationProvider,
      summarizationModel: override?.summarizationModel ?? this.config.summarizationModel,
      maxTokens: override?.maxTokens ?? this.config.maxTokens,
    }
  }

  protected override async summarize(
    input: HandoffSummarizationInput,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<HandoffSummaryResult> {
    const config = this.summaryCallConfig(agent)
    const latestCallConfig = latestDurableCallConfig(agent)
    const latest = latestCallConfig === undefined
      ? undefined
      : { provider: latestCallConfig.provider, model: latestCallConfig.model }
    const agentRoute = completeAgentRoute(agent)
    const configured = config.summarizationProvider.length === 0
      ? undefined
      : {
          provider: config.summarizationProvider,
          model: config.summarizationModel,
        }
    const target = configured ?? latest ?? agentRoute
    if (target === undefined) {
      throw new Error(
        'no provider/model available for summarization: set both BasicCompactionConfig summarization fields, route one request, or set both AgentOptions fields',
      )
    }
    const { alignment: cacheAlignment, controls: requestControls } = reusableRequestControls(
      latestCallConfig,
      target,
    )
    const controlDiagnostics = requestControlDiagnostics(cacheAlignment, requestControls)

    const sourceMessageCount = input.messages.length
    if (sourceMessageCount === 0) {
      const error = new HandoffValidationError(
        'HANDOFF_SOURCE_EMPTY',
        'handoff rejected: the replay source contains zero messages',
      )
      this.ctx.logger.warn(
        `handoff validation failed: code=${error.code} sourceMessages=0 provider=${target.provider} model=${target.model} ${controlDiagnostics} inputTokens=unknown outputTokens=unknown cacheReadTokens=unknown attempt=preflight`,
      )
      throw error
    }

    const fullMessages = agent.session.deriveMessages()
    const sourcePrefix = fullMessages.slice(0, sourceMessageCount)
    if (
      fullMessages.length < sourceMessageCount
      || !isDeepStrictEqual(sourcePrefix, [...input.messages])
    ) {
      const error = new HandoffValidationError(
        'HANDOFF_SOURCE_MISMATCH',
        'handoff rejected: the selected replay source is not the current session surface prefix',
      )
      this.ctx.logger.warn(
        `handoff validation failed: code=${error.code} sourceMessages=${sourceMessageCount} surfaceMessages=${fullMessages.length} provider=${target.provider} model=${target.model} ${controlDiagnostics} inputTokens=unknown outputTokens=unknown cacheReadTokens=unknown attempt=preflight`,
      )
      throw error
    }
    const retainedMessageCount = fullMessages.length - sourceMessageCount

    const hasHumanUserMessage = input.messages.some((message) => (
      message.role === 'user' && message.source.kind === 'user'
    ))
    const recoveryState = this.recoveryState()
    let recovery = recoveryState.has(agent.session)

    for (let attempt = 0; attempt < MAX_HANDOFF_ATTEMPTS; attempt += 1) {
      const instruction = handoffInstruction(sourceMessageCount, {
        retainedMessageCount,
        recovery,
      })
      const assembler = new BlockAssembler()
      const messages = [
        ...fullMessages,
        createUserMessage({
          content: [{ type: 'text', text: instruction }],
          source: { kind: 'plugin', plugin: 'dsh-handoff-compaction' },
        }),
      ]
      const options = {
        provider: target.provider,
        model: target.model,
        ...requestControls,
        messages,
        ...(input.system === undefined ? {} : { system: input.system }),
        ...(input.tools === undefined ? {} : { tools: [...input.tools] }),
        maxTokens: config.maxTokens,
        sessionId: agent.session.id,
        purpose: 'compaction' as const,
        ...(signal === undefined ? {} : { signal }),
      }

      for await (const chunk of this.ctx.llm.stream(options)) {
        assembler.push(chunk)
      }

      const terminalError = finishError(assembler.finish)
      if (terminalError !== undefined) throw terminalError

      const rawOutput = assembler.blocks()
      if (contentHasImage(rawOutput)) {
        throw new LlmError('compaction summary cannot contain image output', 'UNSUPPORTED_CONTENT')
      }
      const summary = rawOutput.filter((block): block is Extract<ContentBlock, { type: 'text' }> => (
        block.type === 'text'
      ))

      try {
        if (assembler.finish.kind === 'tool-calls') {
          throw new HandoffValidationError(
            'HANDOFF_TOOL_CALL_OUTPUT',
            'handoff rejected: the summarizer attempted to call tools instead of returning Markdown',
          )
        }
        if (!summary.some((block) => block.text.trim().length > 0)) {
          throw new HandoffValidationError(
            'HANDOFF_STRUCTURE_INVALID',
            'handoff rejected: summarization produced no text summary content',
          )
        }
        validateHandoffText(
          summary.map((block) => block.text).join('\n'),
          { sourceMessageCount, hasHumanUserMessage },
        )
      } catch (error) {
        if (!(error instanceof HandoffValidationError)) throw error
        recoveryState.add(agent.session)
        const usage = assembler.usage
        this.ctx.logger.warn(
          `handoff validation failed: code=${error.code} sourceMessages=${sourceMessageCount} provider=${options.provider} model=${options.model} ${controlDiagnostics} inputTokens=${usage?.inputTokens ?? 'unknown'} outputTokens=${usage?.outputTokens ?? 'unknown'} cacheReadTokens=${usage?.cacheReadTokens ?? 'unknown'} attempt=${attempt + 1}/${MAX_HANDOFF_ATTEMPTS}`,
        )
        if (attempt === 0) {
          recovery = true
          continue
        }
        throw error
      }
      recoveryState.delete(agent.session)
      const usage = assembler.usage
      this.ctx.logger.info(
        `handoff summary completed: sourceMessages=${sourceMessageCount} surfaceMessages=${fullMessages.length} provider=${options.provider} model=${options.model} ${controlDiagnostics} inputTokens=${usage?.inputTokens ?? 'unknown'} outputTokens=${usage?.outputTokens ?? 'unknown'} cacheReadTokens=${usage?.cacheReadTokens ?? 'unknown'} attempt=${attempt + 1}/${MAX_HANDOFF_ATTEMPTS}`,
      )

      return {
        summary,
        rawOutput,
        llmStreamCall: true,
        provider: options.provider,
        model: options.model,
        maxTokens: config.maxTokens,
        ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
      }
    }

    throw new Error('handoff summarization attempts exhausted without a terminal result')
  }
}

export default HandoffCompactionEngine
