import { AIMessage, SystemMessage, type AIMessageChunk, type BaseMessage } from '@langchain/core/messages'
import { concat } from '@langchain/core/utils/stream'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { Callbacks } from '@langchain/core/callbacks/manager'
import { MAX_STEPS_NOTE } from './loop-control.js'
import { withRetry, isRetryable, MAX_RETRIES } from './retry.js'
import { logInfo, logDebug } from '../debug-logger.js'
import { parseDsmlToolCalls, hasDsmlToolCalls } from './dsml.js'

/** Per-step run options: the streaming sinks + whether tools are bound (off on the final, capped step). */
export interface ModelRunOptions {
  tools: StructuredToolInterface[]
  bindTools: boolean
  signal?: AbortSignal
  onText: (delta: string) => void
  onReasoning: (delta: string) => void
  /**
   * Optional progress pulse when the model streams tool-call arguments without text.
   * Keeps idle watchdogs alive during large write_file / edit_file arg generation.
   */
  onActivity?: () => void
  /**
   * LangChain runnable fragments so LangSmith nests this LLM under the parent
   * graph/node run (when LANGSMITH_TRACING=true).
   */
  callbacks?: Callbacks
  metadata?: Record<string, unknown>
  tags?: string[]
  runName?: string
}

/**
 * True when a stream chunk carries tool-call progress (args or completed calls)
 * even if there is no assistant text. Used to kick idle watchdogs during large
 * tool-arg generation (e.g. full SVG rewrite via write_file).
 */
export function hasToolCallStreamActivity(chunk: AIMessageChunk): boolean {
  const tcc = (chunk as { tool_call_chunks?: unknown[] }).tool_call_chunks
  if (Array.isArray(tcc) && tcc.length > 0) return true
  const tc = chunk.tool_calls
  if (Array.isArray(tc) && tc.length > 0) return true
  return false
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

/**
 * Collapse streamed array content (many micro text/reasoning blocks) into a
 * single text string, or [reasoning, text] when chain-of-thought is present.
 * Keeps LangSmith / message state readable; real newlines stay as real `\n`.
 */
export function collapseStreamedAiContent(
  content: AIMessage['content'],
): AIMessage['content'] {
  if (typeof content === 'string' || !Array.isArray(content)) return content

  let text = ''
  let reasoning = ''
  let thinking = ''
  const other: Array<Record<string, unknown>> = []

  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as { type?: string; text?: string; reasoning?: string; thinking?: string }
    if (b.type === 'text' && typeof b.text === 'string') {
      text += b.text
      continue
    }
    if (b.type === 'reasoning' && typeof b.reasoning === 'string') {
      reasoning += b.reasoning
      continue
    }
    if (b.type === 'thinking' && typeof b.thinking === 'string') {
      thinking += b.thinking
      continue
    }
    other.push(block as Record<string, unknown>)
  }

  if (other.length === 0 && !reasoning && !thinking) return text

  const blocks: Array<Record<string, unknown>> = []
  if (reasoning) blocks.push({ type: 'reasoning', reasoning, index: 7 })
  if (thinking) blocks.push({ type: 'thinking', thinking, index: 7 })
  if (text) blocks.push({ type: 'text', text, index: 0 })
  blocks.push(...other)

  if (blocks.length === 1 && blocks[0].type === 'text') return text
  return blocks as AIMessage['content']
}

/** Rebuild an AIMessage with collapsed content (preserves tool_calls / metadata). */
export function collapseStreamedAiMessage(msg: AIMessage): AIMessage {
  const collapsed = collapseStreamedAiContent(msg.content)
  if (collapsed === msg.content) return msg
  return new AIMessage({
    content: collapsed,
    tool_calls: msg.tool_calls,
    invalid_tool_calls: msg.invalid_tool_calls,
    id: msg.id,
    additional_kwargs: msg.additional_kwargs,
    response_metadata: msg.response_metadata,
    usage_metadata: msg.usage_metadata,
  })
}

/**
 * If the model put DSML tool-call markup in content (DeepSeek V4) and left
 * structured tool_calls empty, recover them so the agent loop can execute tools.
 */
export function recoverDsmlToolCalls(msg: AIMessage): AIMessage {
  const existing = msg.tool_calls
  if (existing && existing.length > 0) return msg

  const raw =
    typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content
            .filter((b): b is { type: 'text'; text: string } => (b as { type?: string }).type === 'text')
            .map((b) => b.text)
            .join('')
        : ''
  if (!raw || !hasDsmlToolCalls(raw)) return msg

  const parsed = parseDsmlToolCalls(raw)
  if (parsed.recovered) {
    logInfo('model', 'dsml_recovered', { count: parsed.toolCalls.length, names: parsed.toolCalls.map((t) => t.name) })
    return new AIMessage({
      content: parsed.content,
      tool_calls: parsed.toolCalls.map((t) => ({
        id: t.id,
        name: t.name,
        args: t.args,
        type: 'tool_call' as const,
      })),
      id: msg.id,
      additional_kwargs: msg.additional_kwargs,
      response_metadata: msg.response_metadata,
    })
  }

  // Incomplete/unparseable DSML: strip markup so raw tags are not the final answer.
  if (parsed.content !== raw) {
    logInfo('model', 'dsml_stripped', { reason: 'parse_failed' })
    return new AIMessage({
      content: parsed.content,
      id: msg.id,
      additional_kwargs: msg.additional_kwargs,
      response_metadata: msg.response_metadata,
    })
  }
  return msg
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
      const stream = await bound.stream(input, {
        signal: opts.signal,
        ...(opts.callbacks !== undefined ? { callbacks: opts.callbacks } : {}),
        ...(opts.metadata ? { metadata: opts.metadata } : {}),
        ...(opts.tags ? { tags: opts.tags } : {}),
        ...(opts.runName ? { runName: opts.runName } : {}),
      })
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
        // Tool-call arg streams often have empty content; still count as progress so
        // the turn idle watchdog does not fire mid write_file / large edit generation.
        if (hasToolCallStreamActivity(chunk)) {
          if (firstToken) { firstToken = false; logDebug('model', 'first-token', { latencyMs: Date.now() - t0, kind: 'tool_call' }) }
          emitted = true
          opts.onActivity?.()
        }
      }
      logInfo('model', 'stream:end', { totalMs: Date.now() - t0, contentLen: typeof gathered?.content === 'string' ? gathered.content.length : 0, hadText: emitted })
      if (!gathered) throw new Error('model produced no output')
      // Collapse micro text/reasoning blocks from stream concat before DSML recovery
      // and before the message enters graph state / LangSmith child spans.
      return recoverDsmlToolCalls(collapseStreamedAiMessage(gathered as AIMessage))
    }
    // Retry only transient failures thrown BEFORE the first delta — retrying mid-stream would
    // duplicate already-emitted tokens. Once `emitted` is true, shouldRetry returns false → rethrow.
    return withRetry(attempt, { maxRetries: MAX_RETRIES, signal: opts.signal, shouldRetry: (e) => !emitted && isRetryable(e) })
  }
}
