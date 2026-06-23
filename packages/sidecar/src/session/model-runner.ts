import type { AIMessage, AIMessageChunk, BaseMessage } from '@langchain/core/messages'
import { SystemMessage } from '@langchain/core/messages'
import { concat } from '@langchain/core/utils/stream'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ChatOpenAI } from '@langchain/openai'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { MAX_STEPS_NOTE } from './loop-control.js'
import { withRetry, isRetryable, MAX_RETRIES } from './retry.js'
import { logInfo, logDebug } from '../debug-logger.js'

/** Per-step run options: the streaming sinks + whether tools are bound (off on the final, capped step). */
export interface ModelRunOptions {
  tools: StructuredToolInterface[]
  bindTools: boolean
  signal?: AbortSignal
  onText: (delta: string) => void
  onReasoning: (delta: string) => void
}

/** One model turn: stream deltas to the sinks, return the gathered assistant message (with tool_calls). */
export interface ModelRunner {
  run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage>
}

/** Per-chunk text delta: plain string, or the text blocks of array content. */
export function textDelta(chunk: AIMessageChunk): string {
  if (typeof chunk.content === 'string') return chunk.content
  return chunk.content
    .filter((b): b is { type: 'text'; text: string } => (b as { type?: string }).type === 'text')
    .map((b) => b.text)
    .join('')
}

/** Per-chunk reasoning delta: reasoning/thinking blocks of array content, else additional_kwargs.reasoning_content. */
export function reasoningDelta(chunk: AIMessageChunk): string {
  if (Array.isArray(chunk.content)) {
    const fromBlocks = chunk.content
      .filter((b): b is { type: 'reasoning'; reasoning: string } => (b as { type?: string }).type === 'reasoning')
      .map((b) => b.reasoning)
      .join('')
    if (fromBlocks) return fromBlocks

    const fromThinkingBlocks = chunk.content
      .filter((b): b is { type: 'thinking'; thinking: string } => (b as { type?: string }).type === 'thinking')
      .map((b) => b.thinking)
      .join('')
    if (fromThinkingBlocks) return fromThinkingBlocks
  }
  const rc = (chunk.additional_kwargs as { reasoning_content?: unknown } | undefined)?.reasoning_content
  return typeof rc === 'string' ? rc : ''
}

/** Production runner over a ChatOpenAI/ReasoningChatOpenAI instance. */
export class RealModelRunner implements ModelRunner {
  constructor(private readonly model: BaseChatModel) {}

  async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    const bound = opts.bindTools ? this.model.bindTools!(opts.tools) : this.model
    const input: BaseMessage[] = opts.bindTools ? messages : [...messages, new SystemMessage(MAX_STEPS_NOTE)]
    let emitted = false
    const attempt = async (): Promise<AIMessage> => {
      const t0 = Date.now()
      logDebug('model', 'stream:start', { model: (bound as any).model ?? (bound as any).modelName ?? 'unknown' })
      const stream = await bound.stream(input, { signal: opts.signal })
      let gathered: AIMessageChunk | undefined
      let firstToken = true
      for await (const chunk of stream) {
        gathered = gathered ? (concat(gathered, chunk) as AIMessageChunk) : chunk
        const t = textDelta(chunk)
        if (t) {
          if (firstToken) { firstToken = false; logDebug('model', 'first-token', { latencyMs: Date.now() - t0 }) }
          emitted = true; opts.onText(t)
        }
        const r = reasoningDelta(chunk)
        if (r) { emitted = true; opts.onReasoning(r) }
      }
      logInfo('model', 'stream:end', { totalMs: Date.now() - t0, contentLen: typeof gathered?.content === 'string' ? gathered.content.length : 0, hadText: emitted })
      if (!gathered) throw new Error('model produced no output')
      return gathered as AIMessage
    }
    // Retry only transient failures thrown BEFORE the first delta — retrying mid-stream would
    // duplicate already-emitted tokens. Once `emitted` is true, shouldRetry returns false → rethrow.
    return withRetry(attempt, { maxRetries: MAX_RETRIES, signal: opts.signal, shouldRetry: (e) => !emitted && isRetryable(e) })
  }
}
