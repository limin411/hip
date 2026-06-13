import type { AIMessage, AIMessageChunk, BaseMessage } from '@langchain/core/messages'
import { SystemMessage } from '@langchain/core/messages'
import { concat } from '@langchain/core/utils/stream'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ChatOpenAI } from '@langchain/openai'
import { MAX_STEPS_NOTE } from './loop-control.js'

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

/** Per-chunk reasoning delta: reasoning blocks of array content, else additional_kwargs.reasoning_content. */
export function reasoningDelta(chunk: AIMessageChunk): string {
  if (Array.isArray(chunk.content)) {
    const fromBlocks = chunk.content
      .filter((b): b is { type: 'reasoning'; reasoning: string } => (b as { type?: string }).type === 'reasoning')
      .map((b) => b.reasoning)
      .join('')
    if (fromBlocks) return fromBlocks
  }
  const rc = (chunk.additional_kwargs as { reasoning_content?: unknown } | undefined)?.reasoning_content
  return typeof rc === 'string' ? rc : ''
}

/** Production runner over a ChatOpenAI/ReasoningChatOpenAI instance. */
export class RealModelRunner implements ModelRunner {
  constructor(private readonly model: ChatOpenAI) {}

  async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    const bound = opts.bindTools ? this.model.bindTools(opts.tools) : this.model
    const input: BaseMessage[] = opts.bindTools ? messages : [...messages, new SystemMessage(MAX_STEPS_NOTE)]
    const stream = await bound.stream(input, { signal: opts.signal })
    let gathered: AIMessageChunk | undefined
    for await (const chunk of stream) {
      gathered = gathered ? (concat(gathered, chunk) as AIMessageChunk) : chunk
      const t = textDelta(chunk)
      if (t) opts.onText(t)
      const r = reasoningDelta(chunk)
      if (r) opts.onReasoning(r)
    }
    if (!gathered) throw new Error('model produced no output')
    return gathered as AIMessage
  }
}
