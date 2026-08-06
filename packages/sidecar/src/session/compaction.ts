import { SystemMessage, HumanMessage, AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import {
  AUTO_COMPACT_THRESHOLD_PERCENT,
  CHARS_PER_TOKEN,
  DEFAULT_COMPACT_TRIGGER_TOKENS,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_SUBAGENT_COMPACT_TRIGGER_TOKENS,
  MIN_SUMMARY_SEED_CHARS,
  compactTriggerTokens,
  estimateMessagesTokens,
  estimatePromptTokens,
  estimateTextTokens,
  extractiveSummaryFallback,
  isDegenerateSummary,
  remainingBudgetPercent,
  selectKeepUnitsByTokenBudget,
  type PromptEstimateInput,
} from './context-budget.js'


/** @deprecated Prefer `compactTriggerTokens(contextWindow)`. Absolute default for 128k × 85%. */
export const COMPACT_BUDGET_TOKENS = DEFAULT_COMPACT_TRIGGER_TOKENS

/** @deprecated Prefer `compactTriggerTokens(window, SUBAGENT_COMPACT_THRESHOLD_PERCENT)`. */
export const SUBAGENT_COMPACT_BUDGET_TOKENS = DEFAULT_SUBAGENT_COMPACT_TRIGGER_TOKENS

export {
  AUTO_COMPACT_THRESHOLD_PERCENT,
  DEFAULT_CONTEXT_WINDOW,
  compactTriggerTokens,
  estimatePromptTokens,
  estimateTextTokens,
  remainingBudgetPercent,
  selectKeepUnitsByTokenBudget,
  type PromptEstimateInput,
}

/** Turns kept verbatim at the tail (user-turn mode). A turn = a user message and everything up to the next one. */
export const KEEP_RECENT_TURNS = 3

/** Tool-rounds kept verbatim at the tail when compacting single-Human ReAct loops. */
export const KEEP_RECENT_TOOL_ROUNDS = 6

/** Min steps between LLM summary compactions (prune may run every step). */
export const MIN_STEPS_BETWEEN_LLM_COMPACT = 4

/** Token budget for the summarizer model output. */
export const SUMMARY_OUTPUT_TOKENS = 4096

/** Structured summary carrier prefix (stable for post-compact re-assembly). */
export const COMPACT_SUMMARY_PREFIX = '[对话摘要]'

/**
 * Required section headers for LLM compact summaries (OpenCode-style G14).
 * Durable goal/todos/verify are appended separately via `appendProtectedStructures`
 * (`## Active goal (do not drop)`); do not drop them if they appear in the span.
 */
export const COMPACT_SUMMARY_SECTIONS = [
  '## Objective',
  '## Important Details',
  '## Work State',
  '## Next Move',
  '## Relevant Files',
] as const

/** Summarizer system prompt: structured sections + preserve critical facts. */
export const SUMMARY_TEMPLATE = `你是一个对话压缩器。你需要从较早的对话片段中提取结构化摘要，以便后续模型能够准确理解已发生的事情并继续推进任务。严格按以下结构输出（英文 section 标题不可改写）：

## Objective
用户原始任务目标与意图。若对话中已有 durable goal / success criteria，原样保留关键表述。

## Important Details
必须保留的约束、偏好、关键决策、错误原文、命令、路径与不可丢的事实。包含完整文本，不得截断关键错误或路径。

## Work State
当前进度：已完成、进行中、阻塞/等待。用简洁列表。

## Next Move
仍需完成的下一步（可执行、具体）。

## Relevant Files
对话中提及或实际修改的文件路径（完整路径）。

规则：
- 只输出上述结构化摘要，不要前言/后记。
- 使用简洁列表；保留精确路径、命令和错误消息原文。
- 若片段中出现 \`## Active goal (do not drop)\`、todos 或 verification 块，完整保留其内容（或写入 Objective / Work State），不可丢弃。
- 后续系统可能再追加 durable goal/todos/verify 保护块；摘要本身不要声称任务已完成 unless evidence 明确。`

/** Summarizes a span of messages into a short note. Injected so compaction is unit-testable. */
export interface Summarizer {
  summarize(messages: BaseMessage[], opts?: { focus?: string; sessionId?: string }): Promise<string>
}

/** Options for compactMessages. */
export interface CompactOptions {
  /**
   * Fallback turn count when `targetKeepTokens` is not set.
   * Still used as a soft max when token budget would keep *everything*.
   */
  keepRecentTurns: number
  /** Summarizer that produces the summary text from the middle span. */
  summarizer: Summarizer
  /** When true, keep fewer recent turns so the summary covers more history — used after a
   *  provider context-overflow error to aggressively shrink the prompt. */
  overflowRecovery?: boolean
  /** Optional focus instruction for the summarizer (manual `/compact focus…`). */
  focus?: string
  /** Session id (optional context for the summarizer path). */
  sessionId?: string
  /** Goal/todos/verify block forced into the summary carrier (long-task M1). */
  protectedStructures?: string
  /**
   * Tool-rounds kept at the tail when falling back to tool-round mode
   * (single-Human ReAct / explore). Defaults to KEEP_RECENT_TOOL_ROUNDS.
   * Soft max when `targetKeepTokens` is set.
   */
  keepRecentToolRounds?: number
  /**
   * Token budget for the verbatim keep-tail (TARGET_THRESHOLD_PERCENT of the
   * context window, minus system/tools overhead). When set, turn/round keep
   * counts are chosen so the tail fits this budget (grok-build style).
   */
  targetKeepTokens?: number
  /**
   * Optional two-pass prefire cache. When NOTE₁ matches the current middle,
   * pass-2 reuses or merges it instead of summarizing the full middle again.
   */
  prefire?: {
    match(middle: BaseMessage[]): { note1: string; delta: BaseMessage[] } | null
    awaitInflight?(timeoutMs?: number): Promise<void>
  }
}

/** Planned compact split (middle span only — no LLM yet). */
export interface CompactMiddlePlan {
  middle: BaseMessage[]
  mode: 'user-turn' | 'tool-round'
  headId: string
}

/** Detect provider context-length / maximum-token errors so the graph can compact and retry. */
export function isOverflowError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const text = `${err.message} ${(err as { code?: string; status?: number; statusCode?: number }).code ?? ''} ${(err as { response?: { status?: number } }).response?.status ?? ''}`.toLowerCase()
  return (
    text.includes('context length') ||
    text.includes('context_length_exceeded') ||
    text.includes('maximum context length') ||
    text.includes('string above max length') ||
    text.includes('too many tokens') ||
    text.includes('input length') ||
    text.includes('token limit') ||
    text.includes('prompt is too long') ||
    text.includes('model_context_window_exceeded')
  )
}

function textOf(m: BaseMessage): string {
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) return m.content.map((b) => (typeof b === 'string' ? b : ((b as { text?: string }).text ?? ''))).join('')
  return ''
}

/** Synchronous chars/4 estimate over message bodies only. Prefer `estimatePromptTokens` for gates. */
export function estimateTokens(messages: readonly BaseMessage[]): number {
  return estimateMessagesTokens(messages)
}

export interface CompactResult {
  /** SystemMessage carrying the summary, id = the middle head's id (replace-in-place keeps order). */
  summary: BaseMessage
  /** ids of the rest of the middle to delete (not including the head). */
  removeIds: string[]
  /** All middle message ids replaced (head + removeIds) — for persistence / rebuild. */
  replacedIds: string[]
  /** Which split strategy produced this plan. */
  mode?: 'user-turn' | 'tool-round'
}

/** Apply a compact plan to an in-memory message list.
 *  Replaces the middle head with `summary` (same id) and drops `removeIds`. Order preserved. */
export function applyCompactResult(messages: readonly BaseMessage[], result: CompactResult): BaseMessage[] {
  const removeSet = new Set(result.removeIds)
  const headId = result.summary.id
  return messages.flatMap((m) => {
    if (m.id && removeSet.has(m.id)) return []
    if (headId && m.id === headId) return [result.summary]
    return [m]
  })
}

/**
 * Split messages after `fromIdx` into tool-rounds.
 * A tool-round starts at an AIMessage with tool_calls and includes following ToolMessages
 * until the next AIMessage (or non-tool message that starts a new segment).
 * Plain AI text without tools is a single-message "round".
 */
export function splitToolRounds(messages: BaseMessage[], fromIdx: number): BaseMessage[][] {
  const rounds: BaseMessage[][] = []
  let i = fromIdx
  while (i < messages.length) {
    const m = messages[i]
    if (m instanceof AIMessage && m.tool_calls && m.tool_calls.length > 0) {
      const round: BaseMessage[] = [m]
      i++
      while (i < messages.length && messages[i] instanceof ToolMessage) {
        round.push(messages[i])
        i++
      }
      rounds.push(round)
      continue
    }
    // Non-tool AI or other — single-message round (skip pure system mid-stream rarely)
    rounds.push([m])
    i++
  }
  return rounds
}

/** Build the stable summary carrier SystemMessage. */
export function formatCompactSummaryMessage(headId: string, body: string): SystemMessage {
  const text = body.trim().startsWith(COMPACT_SUMMARY_PREFIX)
    ? body.trim()
    : `${COMPACT_SUMMARY_PREFIX} ${body.trim()}`
  return new SystemMessage({ id: headId, content: text })
}

/**
 * Append protected long-task structures (goal / todos / verify) so compaction
 * cannot drop them from the summary carrier.
 */
export function appendProtectedStructures(summaryBody: string, protectedBlock: string | undefined | null): string {
  const block = (protectedBlock ?? '').trim()
  if (!block) return summaryBody
  const marker = '## Active goal (do not drop)'
  if (summaryBody.includes(marker)) return summaryBody
  return `${summaryBody.trim()}\n\n${block}`
}

/**
 * Build pass-2 summarizer input: NOTE₁ + optional delta messages (two-pass prefire).
 * When delta is empty, the caller can use note1 directly without another LLM call.
 */
export function buildPass2SeedMessages(note1: string, delta: BaseMessage[]): BaseMessage[] {
  const seed = new SystemMessage(
    `Previous conversation summary (NOTE₁ — already compressed; preserve all critical facts):\n\n${note1}`,
  )
  if (delta.length === 0) return [seed]
  return [
    seed,
    new HumanMessage(
      'Additional conversation after NOTE₁ (compress together with NOTE₁ into one structured summary):',
    ),
    ...delta,
  ]
}

/**
 * Run summarizer with quality gate: retry once on degenerate output, then extractive fallback.
 */
export async function summarizeWithQualityGate(
  middle: BaseMessage[],
  opts: Pick<CompactOptions, 'summarizer' | 'focus' | 'sessionId'>,
): Promise<string> {
  const run = (focus?: string) =>
    opts.summarizer.summarize(middle, {
      ...(focus ? { focus } : opts.focus ? { focus: opts.focus } : {}),
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    })

  let text = ''
  try {
    text = await run(opts.focus)
  } catch {
    text = ''
  }

  if (!isDegenerateSummary(text, MIN_SUMMARY_SEED_CHARS)) return text.trim()

  try {
    const retryFocus = [opts.focus?.trim(), 'Provide a detailed structured summary with all critical paths, errors, and decisions.']
      .filter(Boolean)
      .join('\n')
    text = await run(retryFocus)
  } catch {
    text = ''
  }

  if (!isDegenerateSummary(text, MIN_SUMMARY_SEED_CHARS)) return text.trim()

  return extractiveSummaryFallback(middle)
}

async function summarizeMiddle(
  middle: BaseMessage[],
  opts: CompactOptions,
  mode: 'user-turn' | 'tool-round',
): Promise<CompactResult | null> {
  if (middle.length === 0) return null
  const headId = middle[0].id
  if (!headId) return null
  let text = await summarizeWithQualityGate(middle, opts)
  text = appendProtectedStructures(text, opts.protectedStructures)
  const removeIds = middle.slice(1).map((m) => m.id).filter((id): id is string => !!id)
  return {
    summary: formatCompactSummaryMessage(headId, text),
    removeIds,
    replacedIds: [headId, ...removeIds],
    mode,
  }
}

/** Token estimate for each human-turn span (oldest → newest). */
export function humanTurnTokenCounts(messages: BaseMessage[], humanIdxs: number[]): number[] {
  return humanIdxs.map((start, i) => {
    const end = i + 1 < humanIdxs.length ? humanIdxs[i + 1] : messages.length
    return estimateMessagesTokens(messages.slice(start, end))
  })
}

/** Resolve how many recent human-turns to keep. */
export function resolveKeepRecentTurns(
  messages: BaseMessage[],
  humanIdxs: number[],
  opts: CompactOptions,
): number {
  const fallback = opts.overflowRecovery
    ? Math.max(1, Math.floor(opts.keepRecentTurns / 2))
    : opts.keepRecentTurns
  if (humanIdxs.length === 0) return 0
  // Classic fixed keep (no token budget): preserve prior semantics, including
  // "keep == human count ⇒ no user-turn compact" (caller checks length > keep).
  if (opts.targetKeepTokens == null || opts.targetKeepTokens <= 0) {
    return fallback
  }
  // Leave the first human out of the "recent" budget so middle can be non-empty.
  const maxKeep = Math.max(1, humanIdxs.length - 1)
  const counts = humanTurnTokenCounts(messages, humanIdxs)
  // Do not spend budget on the first human (always pinned separately).
  const recentCounts = counts.length > 1 ? counts.slice(1) : counts
  if (recentCounts.length === 0) return fallback
  const softMax = Math.min(Math.max(fallback, fallback * 2), maxKeep, recentCounts.length)
  const keep = selectKeepUnitsByTokenBudget(recentCounts, opts.targetKeepTokens, {
    minKeep: 1,
    maxKeep: softMax,
  })
  // Prefer at least the classic fallback when the budget easily fits it.
  if (keep < fallback && recentCounts.length >= fallback) {
    const fallbackTokens = recentCounts
      .slice(recentCounts.length - fallback)
      .reduce((a, b) => a + b, 0)
    if (fallbackTokens <= opts.targetKeepTokens) return Math.min(fallback, maxKeep)
  }
  return Math.max(1, Math.min(keep, maxKeep, recentCounts.length))
}

/** Resolve how many recent tool-rounds to keep. */
export function resolveKeepRecentToolRounds(
  rounds: BaseMessage[][],
  opts: CompactOptions,
): number {
  const fallback = opts.overflowRecovery
    ? Math.max(2, Math.floor((opts.keepRecentToolRounds ?? KEEP_RECENT_TOOL_ROUNDS) / 2))
    : (opts.keepRecentToolRounds ?? KEEP_RECENT_TOOL_ROUNDS)
  if (rounds.length === 0) return 0
  // Classic fixed keep when no token budget.
  if (opts.targetKeepTokens == null || opts.targetKeepTokens <= 0) {
    return fallback
  }
  const maxKeep = Math.max(1, rounds.length - 1)
  const counts = rounds.map((r) => estimateMessagesTokens(r))
  const softMax = Math.min(Math.max(fallback, fallback * 2), maxKeep)
  const keep = selectKeepUnitsByTokenBudget(counts, opts.targetKeepTokens, {
    minKeep: opts.overflowRecovery ? 1 : Math.min(fallback, 2),
    maxKeep: softMax,
  })
  if (keep < fallback && counts.length >= fallback) {
    const fallbackTokens = counts.slice(counts.length - fallback).reduce((a, b) => a + b, 0)
    if (fallbackTokens <= opts.targetKeepTokens) return Math.min(fallback, maxKeep)
  }
  return Math.max(1, Math.min(keep, maxKeep))
}

/**
 * Pure: select the middle span that would be summarized (no LLM).
 * Shared by compactMessages, prefire pass-1, and two-pass pass-2.
 */
export function selectCompactMiddle(
  messages: BaseMessage[],
  opts: Pick<CompactOptions, 'keepRecentTurns' | 'keepRecentToolRounds' | 'overflowRecovery' | 'targetKeepTokens'>,
): CompactMiddlePlan | null {
  const firstHumanIdx = messages.findIndex((m) => m instanceof HumanMessage)
  if (firstHumanIdx === -1) return null

  const humanIdxs: number[] = []
  messages.forEach((m, i) => { if (m instanceof HumanMessage) humanIdxs.push(i) })
  const keepRecentTurns = resolveKeepRecentTurns(messages, humanIdxs, {
    ...opts,
    summarizer: { async summarize() { return '' } },
  })

  // User-turn path when enough human turns for a non-empty middle.
  if (humanIdxs.length > keepRecentTurns) {
    const recentStart = humanIdxs[humanIdxs.length - keepRecentTurns]
    const middle = messages.slice(firstHumanIdx + 1, recentStart)
    if (middle.length > 0 && middle[0].id) {
      return { middle, mode: 'user-turn', headId: middle[0].id }
    }
  }

  // Tool-round fallback
  const afterHuman = firstHumanIdx + 1
  if (afterHuman >= messages.length) return null
  const rounds = splitToolRounds(messages, afterHuman)
  const keepRounds = resolveKeepRecentToolRounds(rounds, {
    ...opts,
    summarizer: { async summarize() { return '' } },
  })
  if (rounds.length <= keepRounds) return null
  const middleRounds = rounds.slice(0, rounds.length - keepRounds)
  const middle = middleRounds.flat()
  if (middle.length === 0 || !middle[0].id) return null
  return { middle, mode: 'tool-round', headId: middle[0].id }
}

/**
 * Tool-round compaction for single-Human ReAct loops (explore / task / dispatch).
 * Pins system + first human; summarizes middle tool-rounds; keeps recent rounds intact.
 */
export async function compactToolRounds(
  messages: BaseMessage[],
  opts: CompactOptions,
): Promise<CompactResult | null> {
  const plan = selectCompactMiddle(messages, opts)
  if (!plan || plan.mode !== 'tool-round') {
    // selectCompactMiddle may return user-turn; for explicit tool-round API keep old path
    const firstHumanIdx = messages.findIndex((m) => m instanceof HumanMessage)
    if (firstHumanIdx === -1) return null
    const afterHuman = firstHumanIdx + 1
    if (afterHuman >= messages.length) return null
    const rounds = splitToolRounds(messages, afterHuman)
    const keepRounds = resolveKeepRecentToolRounds(rounds, opts)
    if (rounds.length <= keepRounds) return null
    const middle = rounds.slice(0, rounds.length - keepRounds).flat()
    if (middle.length === 0) return null
    return summarizeMiddle(middle, opts, 'tool-round')
  }
  return summarizeMiddle(plan.middle, opts, 'tool-round')
}

/**
 * Summarize a planned middle, optionally using two-pass prefire NOTE₁.
 */
async function summarizeMiddleWithPrefire(
  plan: CompactMiddlePlan,
  opts: CompactOptions,
): Promise<CompactResult | null> {
  const { middle, mode, headId } = plan
  if (opts.prefire) {
    try {
      await opts.prefire.awaitInflight?.(2_000)
    } catch {
      // ignore
    }
    const hit = opts.prefire.match(middle)
    if (hit) {
      let text = hit.note1
      if (hit.delta.length > 0) {
        // Pass-2: merge NOTE₁ + delta into one summary.
        text = await summarizeWithQualityGate(buildPass2SeedMessages(hit.note1, hit.delta), opts)
      }
      // Reuse quality gate only when we had delta; pure NOTE₁ already gated in pass-1.
      if (hit.delta.length === 0 || text.trim()) {
        text = appendProtectedStructures(text.trim() || hit.note1, opts.protectedStructures)
        const removeIds = middle.slice(1).map((m) => m.id).filter((id): id is string => !!id)
        return {
          summary: formatCompactSummaryMessage(headId, text),
          removeIds,
          replacedIds: [headId, ...removeIds],
          mode,
        }
      }
    }
  }
  return summarizeMiddle(middle, opts, mode)
}

/**
 * Plan a compaction:
 * 1. Prefer user-turn boundaries when there are enough HumanMessages (multi-turn chat).
 * 2. Else fall back to tool-round boundaries so explore/subagent loops can shrink.
 * 3. When `opts.prefire` has a valid NOTE₁, reuse or merge it (two-pass).
 *
 * Keep-tail size uses `targetKeepTokens` when provided (≈50% of context window);
 * otherwise falls back to KEEP_RECENT_TURNS / KEEP_RECENT_TOOL_ROUNDS.
 *
 * Never splits an AIMessage from its ToolMessages in tool-round mode.
 * `messages` must have ids (LangGraph assigns them in state).
 */
export async function compactMessages(
  messages: BaseMessage[],
  opts: CompactOptions,
): Promise<CompactResult | null> {
  const plan = selectCompactMiddle(messages, opts)
  if (!plan) return null
  return summarizeMiddleWithPrefire(plan, opts)
}

// Re-export for callers that previously imported CHARS_PER_TOKEN indirectly.
export { CHARS_PER_TOKEN }
