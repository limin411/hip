import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { SystemMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { getActiveModel, cheapModelFor } from '../config/providers.js'
import { clampEffortForModel } from '../config/catalog.js'
import {
  normalizeAnthropicApiUrl,
  resolveChatApiKind,
} from '../config/chat-api-kind.js'
import { resolveApiKey } from '../config/auth-file.js'
import { langSmithModelCallConfig } from '../observability/langsmith.js'
import { SUMMARY_OUTPUT_TOKENS, type Summarizer } from './compaction.js'

/** Stable content-block index for the re-projected reasoning block — distinct from text (0)
 *  and tool-call chunk indices so it accumulates as its own block in convertChunksToEvents. */
const REASONING_BLOCK_INDEX = 7

/** Strip re-projected `reasoning`/`thinking` content blocks from a message's content so they never
 *  reach the OpenAI request body. langchain's v0 outbound converter passes array blocks through raw,
 *  and these blocks also leak into ToolMessages (which carry no output_version tag and so bypass the
 *  v1 text-only filter), making DeepSeek 400 ("unknown variant `reasoning`"). Mutates in place. */
export function stripReasoningBlocks(messages: readonly { content: unknown }[]): void {
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue
    const kept = m.content.filter((b) => {
      const t = (b as { type?: unknown } | null)?.type
      return t !== 'reasoning' && t !== 'thinking'
    })
    if (kept.length === m.content.length) continue
    // Collapse to a plain string when only a single text block survives (the common case),
    // else keep the filtered array. Empty → '' so the assistant turn still serializes.
    if (kept.length === 1 && (kept[0] as { type?: unknown }).type === 'text') {
      ;(m as { content: unknown }).content = (kept[0] as { text?: string }).text ?? ''
    } else {
      ;(m as { content: unknown }).content = kept.length === 0 ? '' : kept
    }
  }
}

/**
 * @langchain/openai surfaces DeepSeek chain-of-thought ONLY as
 * additional_kwargs.reasoning_content; langchain-core's v3 stream-event producer reads
 * `content` and ignores additional_kwargs, so ChatModelStream.reasoning (deepagents'
 * msg.reasoning) is empty. Re-project each reasoning delta into a typed `reasoning`
 * content block (stable index) so 2nd+ chunks emit `reasoning-delta` events that feed
 * `.reasoning`. That block accumulates into langgraph's message state, so on the *next*
 * request we strip it back out (stripReasoningBlocks) before super builds the outbound body —
 * otherwise DeepSeek 400s on the re-serialized `reasoning` block. withConfig is overridden too:
 * ChatOpenAI.withConfig rebuilds a plain ChatOpenAI from `this.fields`, which would drop this
 * subclass (deepagents calls withConfig).
 */
/**
 * Normalize a stream delta so concat/ChatGenerationChunk.concat can merge tokens.
 *
 * Bug: when only the first delta has reasoning_content we used to emit
 * `[reasoning@7, text@0]`, then later plain-string deltas. concat appends those
 * strings as separate unindexed `text` blocks → LangSmith shows dozens of
 * micro-blocks and literal `\\n` fragments.
 *
 * Fix: every string delta becomes indexed content blocks (text always index 0)
 * so consecutive tokens merge into one text field (real newlines stay real).
 */
export function projectReasoningStreamContent(
  content: unknown,
  reasoningContent: unknown,
): unknown {
  if (typeof content !== 'string') return content
  const rc = typeof reasoningContent === 'string' && reasoningContent.length > 0 ? reasoningContent : ''
  if (!rc && content.length === 0) return content
  const blocks: Array<Record<string, unknown>> = []
  if (rc) blocks.push({ type: 'reasoning', reasoning: rc, index: REASONING_BLOCK_INDEX })
  if (content.length > 0) blocks.push({ type: 'text', text: content, index: 0 })
  return blocks.length === 0 ? content : blocks
}

export class ReasoningChatOpenAI extends ChatOpenAI {
  /**
   * LangSmith / serialize id segment. Without this, traces show the class name
   * `ReasoningChatOpenAI` as the LLM run name when no explicit runName is set.
   */
  static lc_name(): string {
    return 'hip.model'
  }

  async *_streamResponseChunks(
    messages: Parameters<ChatOpenAI['_streamResponseChunks']>[0],
    options: Parameters<ChatOpenAI['_streamResponseChunks']>[1],
    runManager?: Parameters<ChatOpenAI['_streamResponseChunks']>[2],
  ): ReturnType<ChatOpenAI['_streamResponseChunks']> {
    stripReasoningBlocks(messages)
    for await (const chunk of super._streamResponseChunks(messages, options, runManager)) {
      const msg = chunk.message as unknown as { content: unknown; additional_kwargs?: { reasoning_content?: unknown } }
      msg.content = projectReasoningStreamContent(msg.content, msg.additional_kwargs?.reasoning_content) as typeof msg.content
      yield chunk
    }
  }

  withConfig(config: Parameters<ChatOpenAI['withConfig']>[0]): ReasoningChatOpenAI {
    const f = (this as unknown as { fields: ConstructorParameters<typeof ChatOpenAI>[0] }).fields
    const m = new ReasoningChatOpenAI(f)
    ;(m as unknown as { defaultOptions: unknown }).defaultOptions = {
      ...(this as unknown as { defaultOptions: Record<string, unknown> }).defaultOptions,
      ...config,
    }
    return m
  }
}

export function activeKey(providerID: string): string {
  return resolveApiKey(providerID) || 'sk-missing'
}

export type BuildChatModelChoice = {
  providerID: string
  modelID: string
  baseURL: string
  /** Reasoning effort from SessionConfig (catalog-advertised values). */
  effort?: string
}

/** OpenAI-compatible reasoning effort values accepted by the SDK. */
const OPENAI_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
/** Anthropic outputConfig.effort values. */
const ANTHROPIC_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/** Normalize effort for OpenAI-compatible providers (null when unset / unsupported). */
export function openAiReasoningEffort(effort: string | undefined): string | undefined {
  if (!effort) return undefined
  return OPENAI_EFFORTS.has(effort) ? effort : undefined
}

/** Normalize effort for Anthropic (undefined when unset / unsupported). */
export function anthropicOutputEffort(effort: string | undefined): string | undefined {
  if (!effort || effort === 'none') return undefined
  if (ANTHROPIC_EFFORTS.has(effort)) return effort
  // Map OpenAI-only "minimal" down to low when using Anthropic.
  if (effort === 'minimal') return 'low'
  return undefined
}

/** Build the production reasoning chat model for a concrete model choice. */
export function buildChatModel(choice: BuildChatModelChoice): BaseChatModel {
  // Drop effort that is invalid for this exact model (catalog-aware) before provider mapping.
  const catalogEffort = clampEffortForModel(choice.providerID, choice.modelID, choice.effort)
  if (resolveChatApiKind(choice.providerID, choice.baseURL) === 'anthropic') {
    const effort = anthropicOutputEffort(catalogEffort)
    const anthropicApiUrl = normalizeAnthropicApiUrl(choice.baseURL)
    // Claude-only adaptive thinking + outputConfig.effort. Other Anthropic-compatible
    // hosts (MiniMax, Kimi, …) accept Messages API but not always Claude effort knobs;
    // only attach those when the official Anthropic provider is selected and effort is set.
    const claudeEffort =
      choice.providerID === 'anthropic' && effort
        ? {
            thinking: { type: 'adaptive' as const },
            outputConfig: { effort: effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' },
          }
        : {}
    return new ChatAnthropic({
      model: choice.modelID,
      apiKey: activeKey(choice.providerID),
      streaming: true,
      streamUsage: true,
      ...(anthropicApiUrl ? { anthropicApiUrl } : {}),
      ...claudeEffort,
    })
  }
  const oe = openAiReasoningEffort(catalogEffort)
  return new ReasoningChatOpenAI({
    model: choice.modelID,
    apiKey: activeKey(choice.providerID),
    configuration: { baseURL: choice.baseURL },
    streaming: true,
    streamUsage: true,
    ...(oe
      ? {
          reasoning: { effort: oe as 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' },
        }
      : {}),
  })
}

export const SUMMARY_TEMPLATE = `你是一个对话压缩器。你需要从较早的对话片段中提取结构化摘要，以便后续模型能够准确理解已发生的事情。严格按以下结构输出：

## Goal
用户原始任务目标和意图。

## Constraints & Preferences
会话中明确提到的约束、模式或偏好。

## Progress
### Done
已完成的工作。
### In Progress
当前正在进行的工作。
### Blocked
被阻塞、等待反馈或搁置的事项。

## Key Decisions
对话中的重要决策和选择。

## Next Steps
仍需完成的后续步骤。

## Critical Context
必须原样保留的路径、命令、错误信息或事实。包含完整文本，不得截断。

## Relevant Files
对话中提及的文件路径。

## Files Modified
根据工具结果实际写入或编辑的文件。

保留精确的路径、命令和错误消息原文。使用简洁的列表形式。只输出结构化摘要。`

/** Production summarizer: one cheap completion over the middle span. Not used in injected-model tests. */
class RealSummarizer implements Summarizer {
  async summarize(messages: BaseMessage[], opts?: { focus?: string; sessionId?: string }): Promise<string> {
    const { providerID, modelID, baseURL } = getActiveModel()
    const model = buildChatModel({ providerID, modelID: cheapModelFor(providerID, modelID), baseURL })
    const transcript = messages.map((m) => `${m.getType()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n')
    const focusNote = opts?.focus?.trim()
      ? `\n\nAdditional focus for this summary (prioritize these topics):\n${opts.focus.trim()}`
      : ''
    const res = await model.invoke(
      [
        new SystemMessage(SUMMARY_TEMPLATE + focusNote),
        new HumanMessage(transcript),
      ],
      langSmithModelCallConfig({
        runName: 'hip.summarize',
        sessionId: opts?.sessionId,
        kind: 'summarize',
      }),
    )
    return typeof res.content === 'string' ? res.content : ''
  }
}

export function createSummarizer(): Summarizer {
  return new RealSummarizer()
}
