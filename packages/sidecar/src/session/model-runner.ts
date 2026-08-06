import { AIMessage, SystemMessage, type AIMessageChunk, type BaseMessage } from '@langchain/core/messages'
import { concat } from '@langchain/core/utils/stream'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { Callbacks } from '@langchain/core/callbacks/manager'
import { ChatAnthropic } from '@langchain/anthropic'
import { MAX_STEPS_NOTE } from './loop-control.js'
import { withRetry, isRetryable, MAX_RETRIES } from './retry.js'
import { logInfo, logDebug } from '../debug-logger.js'
import { parseDsmlToolCalls, hasDsmlToolCalls } from './dsml.js'
import { createThinkTagStreamSplitter } from './think-tags.js'
import { prepareAnthropicMessages } from './anthropic-messages.js'
import {
  applyAnthropicToolCacheBreakpoints,
  resolveCachePolicy,
  resolveOpenAiPromptCacheKey,
  sessionIdFromMetadata,
  type CachePolicyInput,
  type PromptCacheKeyMode,
} from './cache-policy.js'

/** True when the chat client is (or wraps) ChatAnthropic — MiniMax-compatible Messages API. */
export function isAnthropicChatModel(model: unknown): boolean {
  if (model instanceof ChatAnthropic) return true
  if (model && typeof model === 'object') {
    const bound = (model as { bound?: unknown }).bound
    if (bound instanceof ChatAnthropic) return true
    const name = (model as { constructor?: { name?: string } }).constructor?.name
    if (name === 'ChatAnthropic' || name === 'ChatAnthropicMessages') return true
  }
  return false
}

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
  /** LangChain runnable fragments (callbacks / metadata / tags / runName). */
  callbacks?: Callbacks
  metadata?: Record<string, unknown>
  tags?: string[]
  runName?: string
  /**
   * Provider cache policy (PR-7b). Default auto when omitted.
   * Anthropic: ephemeral cache_control breakpoints; OpenAI: optional promptCacheKey.
   */
  cachePolicy?: CachePolicyInput
  /** OpenAI prompt_cache_key mode. Default session (use sessionId when available). */
  promptCacheKeyMode?: PromptCacheKeyMode | string
  /** Session id for OpenAI prompt_cache_key (also read from metadata.sessionId). */
  sessionId?: string
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
 * Keeps message state readable; real newlines stay as real `\n`.
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
    const cachePolicy = resolveCachePolicy(
      opts.cachePolicy ?? process.env.HIP_CONTEXT_CACHE_POLICY,
    )
    const isAnthropic = isAnthropicChatModel(this.model)
    // Anthropic: mark last tool definition before bindTools formats them.
    const toolsForBind =
      isAnthropic && opts.bindTools
        ? applyAnthropicToolCacheBreakpoints(opts.tools, cachePolicy)
        : opts.tools
    const bound = opts.bindTools ? this.model.bindTools!(toolsForBind) : this.model
    let input: BaseMessage[] = opts.bindTools ? messages : [...messages, new SystemMessage(MAX_STEPS_NOTE)]
    // MiniMax / Anthropic-compatible: one leading system + cache_control breakpoints.
    if (isAnthropic || isAnthropicChatModel(bound)) {
      input = prepareAnthropicMessages(input, { cachePolicy })
    }
    const promptCacheKey = resolveOpenAiPromptCacheKey({
      model: this.model,
      sessionId: opts.sessionId ?? sessionIdFromMetadata(opts.metadata),
      cachePolicy,
      promptCacheKeyMode: opts.promptCacheKeyMode ?? process.env.HIP_CONTEXT_PROMPT_CACHE_KEY,
    })
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
        // OpenAI-compat prompt cache key (feature-detected; ignored by unsupported clients).
        ...(promptCacheKey ? { promptCacheKey } : {}),
      })
      let gathered: AIMessageChunk | undefined
      let firstToken = true
      // MiniMax (and similar) embed CoT as <think>…</think> inside text deltas.
      // Split for UI sinks only; gathered message keeps raw content for multi-turn CoT.
      const thinkSplit = createThinkTagStreamSplitter()
      const emitText = (raw: string) => {
        if (!raw) return
        const { text, reasoning } = thinkSplit.push(raw)
        if (text) {
          if (firstToken) { firstToken = false; logDebug('model', 'first-token', { latencyMs: Date.now() - t0 }) }
          emitted = true
          opts.onText(text)
        }
        if (reasoning) {
          if (firstToken) { firstToken = false; logDebug('model', 'first-token', { latencyMs: Date.now() - t0, kind: 'reasoning' }) }
          emitted = true
          opts.onReasoning(reasoning)
        }
      }
      for await (const chunk of stream) {
        gathered = gathered ? (concat(gathered, chunk) as AIMessageChunk) : chunk
        // Native reasoning blocks / reasoning_content first (DeepSeek, Anthropic thinking, MiniMax reasoning_split).
        const r = reasoningDelta(chunk)
        if (r) {
          if (firstToken) { firstToken = false; logDebug('model', 'first-token', { latencyMs: Date.now() - t0, kind: 'reasoning' }) }
          emitted = true
          opts.onReasoning(r)
        }
        const t = textDelta(chunk)
        if (t) emitText(t)
        // Tool-call arg streams often have empty content; still count as progress so
        // the turn idle watchdog does not fire mid write_file / large edit generation.
        if (hasToolCallStreamActivity(chunk)) {
          if (firstToken) { firstToken = false; logDebug('model', 'first-token', { latencyMs: Date.now() - t0, kind: 'tool_call' }) }
          emitted = true
          opts.onActivity?.()
        }
      }
      const tail = thinkSplit.flush()
      if (tail.text) { emitted = true; opts.onText(tail.text) }
      if (tail.reasoning) { emitted = true; opts.onReasoning(tail.reasoning) }
      logInfo('model', 'stream:end', { totalMs: Date.now() - t0, contentLen: typeof gathered?.content === 'string' ? gathered.content.length : 0, hadText: emitted })
      if (!gathered) throw new Error('model produced no output')
      // Collapse micro text/reasoning blocks from stream concat before DSML recovery
      // and before the message enters graph state.
      return recoverDsmlToolCalls(collapseStreamedAiMessage(gathered as AIMessage))
    }
    // Retry only transient failures thrown BEFORE the first delta — retrying mid-stream would
    // duplicate already-emitted tokens. Once `emitted` is true, shouldRetry returns false → rethrow.
    return withRetry(attempt, { maxRetries: MAX_RETRIES, signal: opts.signal, shouldRetry: (e) => !emitted && isRetryable(e) })
  }
}
