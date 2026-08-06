/**
 * Context-window budget helpers for auto-compact and remaining-% injection.
 *
 * Aligned with grok-build / industry practice:
 * - trigger at ~85% of model context window (70% for subagents)
 * - chars/4 heuristic when real usage is unavailable
 * - prefer last real prompt token count when present
 *
 * Pure estimation / gate math lives in `@hip/protocol` token-estimation (KD-4).
 * This module re-exports / thin-wraps those helpers and keeps LangChain-aware APIs.
 */
import type { BaseMessage } from '@langchain/core/messages'
import {
  CHARS_PER_TOKEN,
  TOOL_SCHEMA_OVERHEAD_CHARS,
  estimateTextTokens as protocolEstimateTextTokens,
  estimateImageTokens as protocolEstimateImageTokens,
  estimateToolSchemaTokens as protocolEstimateToolSchemaTokens,
  exceedsThreshold as protocolExceedsThreshold,
  exceedsThresholdWithBuffer as protocolExceedsThresholdWithBuffer,
  exceedsGate as protocolExceedsGate,
  usableContextTokens as protocolUsableContextTokens,
  usableContextTokensFromBuffer as protocolUsableContextTokensFromBuffer,
  freeTokens as protocolFreeTokens,
  usagePercentage as protocolUsagePercentage,
  IMAGE_TOKEN_ESTIMATE,
  DEFAULT_OUTPUT_BUFFER_CAP,
  type ContextGateMode,
  type ExceedsGateOptions,
} from '@hip/protocol'
import { readCatalog } from '../config/catalog.js'

export {
  CHARS_PER_TOKEN,
  TOOL_SCHEMA_OVERHEAD_CHARS,
  IMAGE_TOKEN_ESTIMATE,
  DEFAULT_OUTPUT_BUFFER_CAP,
  type ContextGateMode,
  type ExceedsGateOptions,
}

/** Fallback when catalog has no limit.context for the active model. */
export const DEFAULT_CONTEXT_WINDOW = 128_000

/** Supervisor / default auto-compact trigger (% of context window). */
export const AUTO_COMPACT_THRESHOLD_PERCENT = 85

/** Subagent auto-compact trigger — tighter because child graphs bloat faster. */
export const SUBAGENT_COMPACT_THRESHOLD_PERCENT = 70

/**
 * Post-compact target fill (% of window) for the **verbatim keep** tail.
 * Compact should leave roughly this much of the window for recent turns/rounds
 * (+ system/tools overhead is subtracted by the caller when deriving tokens).
 */
export const TARGET_THRESHOLD_PERCENT = 50

/** Minimum keep turns/rounds even when the budget is tiny. */
export const MIN_KEEP_UNITS = 1

/** Floor for target keep tokens so we never keep almost nothing useful. */
export const MIN_TARGET_KEEP_TOKENS = 1_000

/** Summaries shorter than this after trim are treated as degenerate. */
export const MIN_SUMMARY_SEED_CHARS = 80

export interface ToolEstimateInput {
  name: string
  description?: string
  /** Serialized schema JSON when available; else fixed overhead. */
  schemaJson?: string
}

export interface PromptEstimateInput {
  messages: readonly BaseMessage[]
  systemPrompt?: string
  tools?: readonly ToolEstimateInput[]
}

function textOf(m: BaseMessage): string {
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) {
    return m.content
      .map((b) => (typeof b === 'string' ? b : ((b as { text?: string }).text ?? '')))
      .join('')
  }
  return ''
}

/** Bytes/chars ÷ 4 token estimate for a string (delegates to @hip/protocol). */
export function estimateTextTokens(text: string): number {
  return protocolEstimateTextTokens(text)
}

/** Per-image token estimate (delegates to @hip/protocol). */
export function estimateImageTokens(imageCount: number): number {
  return protocolEstimateImageTokens(imageCount)
}

/** Schema / tool overhead tokens (delegates to @hip/protocol). */
export function estimateToolSchemaTokens(schemaJsonOrOverhead?: string | number): number {
  return protocolEstimateToolSchemaTokens(schemaJsonOrOverhead)
}

/** Message-body-only token estimate (no system/tools). */
export function estimateMessagesTokens(messages: readonly BaseMessage[]): number {
  let chars = 0
  for (const m of messages) chars += textOf(m).length
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

/** Rough tool-definition cost: name + description + schema (JSON or fixed overhead). */
export function estimateToolsTokens(tools: readonly ToolEstimateInput[] | undefined): number {
  if (!tools?.length) return 0
  let tokens = 0
  for (const t of tools) {
    tokens += protocolEstimateTextTokens(t.name ?? '')
    tokens += protocolEstimateTextTokens(t.description ?? '')
    tokens += protocolEstimateToolSchemaTokens(
      t.schemaJson !== undefined ? t.schemaJson : TOOL_SCHEMA_OVERHEAD_CHARS,
    )
  }
  return tokens
}

/**
 * Full prompt estimate for budget gates: messages + optional system + tools.
 * Does not include images or provider-side thinking blocks.
 */
export function estimatePromptTokens(input: PromptEstimateInput): number {
  return (
    estimateMessagesTokens(input.messages) +
    estimateTextTokens(input.systemPrompt ?? '') +
    estimateToolsTokens(input.tools)
  )
}

/**
 * Effective used tokens for a gate: prefer the larger of last real prompt usage
 * and the local estimate (usage can lag; estimate covers pre-first-call).
 */
export function effectiveUsedTokens(
  estimated: number,
  lastPromptTokens?: number | null,
): number {
  const real = lastPromptTokens != null && lastPromptTokens > 0 ? lastPromptTokens : 0
  return Math.max(estimated, real)
}

/** Absolute token count that triggers auto-compact for a window + percent. */
export function compactTriggerTokens(
  contextWindow: number = DEFAULT_CONTEXT_WINDOW,
  thresholdPercent: number = AUTO_COMPACT_THRESHOLD_PERCENT,
): number {
  if (contextWindow <= 0) return 0
  const pct = Math.max(0, Math.min(100, thresholdPercent))
  return Math.floor((contextWindow * pct) / 100)
}

/**
 * True when `used >= context_window * threshold_percent / 100`.
 * Integer arithmetic matches grok-build `exceeds_threshold` (>= boundary).
 * Default threshold: AUTO_COMPACT_THRESHOLD_PERCENT (85).
 */
export function exceedsThreshold(
  used: number,
  contextWindow: number,
  thresholdPercent: number = AUTO_COMPACT_THRESHOLD_PERCENT,
): boolean {
  return protocolExceedsThreshold(used, contextWindow, thresholdPercent)
}

/** GB headroom form: used*100 >= window*pct - buffer*100. */
export function exceedsThresholdWithBuffer(
  used: number,
  contextWindow: number,
  thresholdPercent: number = AUTO_COMPACT_THRESHOLD_PERCENT,
  bufferTokens: number = 0,
): boolean {
  return protocolExceedsThresholdWithBuffer(
    used,
    contextWindow,
    thresholdPercent,
    bufferTokens,
  )
}

/** OC-inspired usable width: window − min(bufferCap, maxOutput ?? bufferCap). */
export function usableContextTokens(
  contextWindow: number,
  maxOutput?: number | null,
  bufferCap: number = DEFAULT_OUTPUT_BUFFER_CAP,
): number {
  return protocolUsableContextTokens(contextWindow, maxOutput, bufferCap)
}

/** Usable width from configured outputBufferTokens (optionally capped by maxOutput). */
export function usableContextTokensFromBuffer(
  contextWindow: number,
  bufferTokens: number,
  maxOutput?: number | null,
): number {
  return protocolUsableContextTokensFromBuffer(contextWindow, bufferTokens, maxOutput)
}

/** Dispatch gate by gateMode (percent | usable | percent_minus_buffer). */
export function exceedsGate(
  used: number,
  contextWindow: number,
  thresholdPercent: number = AUTO_COMPACT_THRESHOLD_PERCENT,
  opts?: ExceedsGateOptions,
): boolean {
  return protocolExceedsGate(used, contextWindow, thresholdPercent, opts)
}

/** total − used, saturating at 0. */
export function freeTokens(total: number, used: number): number {
  return protocolFreeTokens(total, used)
}

/** Usage percentage in [0, 100] (float display helper). */
export function usagePercentage(used: number, total: number): number {
  return protocolUsagePercentage(used, total)
}

/** Used fill percent [0, 100] of the context window. */
export function usageFillPercent(used: number, contextWindow: number): number {
  if (contextWindow <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((used / contextWindow) * 100)))
}

/**
 * Remaining budget percent for injectors / model hints.
 * `tokenBudgetPercent` semantics: higher = more room left.
 */
export function remainingBudgetPercent(used: number, contextWindow: number): number {
  if (contextWindow <= 0) return 100
  return Math.max(0, Math.min(100, Math.round(100 - (used / contextWindow) * 100)))
}

/** Resolve context window from catalog; falls back to DEFAULT_CONTEXT_WINDOW. */
export function resolveModelContextWindow(
  providerID: string,
  modelID: string,
  fallback: number = DEFAULT_CONTEXT_WINDOW,
): number {
  try {
    const model = readCatalog()[providerID]?.models?.[modelID]
    const n = model?.limit?.context
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) return Math.floor(n)
  } catch {
    // catalog missing / unreadable
  }
  return fallback
}

/** True when a compaction summary is empty or too short to seed the next turn. */
export function isDegenerateSummary(text: string, minChars: number = MIN_SUMMARY_SEED_CHARS): boolean {
  const t = text.trim()
  if (!t) return true
  return t.length < minChars
}

/**
 * Extractive fallback when the LLM summary is unusable.
 * Prefers recent content; hard-caps characters.
 */
export function extractiveSummaryFallback(
  messages: readonly BaseMessage[],
  maxChars: number = 2000,
): string {
  const parts: string[] = []
  let total = 0
  // Walk newest → oldest so recent facts win, then reverse for chronological read.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const role = typeof m.getType === 'function' ? m.getType() : 'message'
    const body = textOf(m).trim()
    if (!body) continue
    const line = `${role}: ${body.length > 400 ? `${body.slice(0, 397)}...` : body}`
    if (total + line.length + 1 > maxChars) break
    parts.push(line)
    total += line.length + 1
  }
  parts.reverse()
  if (parts.length === 0) {
    return '(no recoverable content from compacted span)'
  }
  return `[extractive]\n${parts.join('\n')}`
}

/** Default absolute budgets (derived from DEFAULT_CONTEXT_WINDOW). */
export const DEFAULT_COMPACT_TRIGGER_TOKENS = compactTriggerTokens(
  DEFAULT_CONTEXT_WINDOW,
  AUTO_COMPACT_THRESHOLD_PERCENT,
)
export const DEFAULT_SUBAGENT_COMPACT_TRIGGER_TOKENS = compactTriggerTokens(
  DEFAULT_CONTEXT_WINDOW,
  SUBAGENT_COMPACT_THRESHOLD_PERCENT,
)

/**
 * Absolute token budget for the verbatim keep-tail after compact.
 * `contextWindow * targetPercent / 100`, floored at MIN_TARGET_KEEP_TOKENS.
 */
export function targetKeepTokens(
  contextWindow: number = DEFAULT_CONTEXT_WINDOW,
  targetPercent: number = TARGET_THRESHOLD_PERCENT,
): number {
  if (contextWindow <= 0) return MIN_TARGET_KEEP_TOKENS
  const pct = Math.max(0, Math.min(100, targetPercent))
  const raw = Math.floor((contextWindow * pct) / 100)
  return Math.max(MIN_TARGET_KEEP_TOKENS, raw)
}

/**
 * How many trailing units (turns or tool-rounds) to keep verbatim so their
 * combined estimate fits `targetTokens`.
 *
 * Walks newest → oldest. Stops when adding the next unit would exceed the
 * budget (after at least `minKeep` units). Caps at `maxKeep` so a non-empty
 * middle remains for summarization when possible.
 *
 * @param unitTokenCounts token estimate per unit, **oldest → newest** order
 * @returns number of trailing units to keep (in [minKeep, maxKeep] when units exist)
 */
export function selectKeepUnitsByTokenBudget(
  unitTokenCounts: readonly number[],
  targetTokens: number,
  opts?: { minKeep?: number; maxKeep?: number },
): number {
  const n = unitTokenCounts.length
  if (n === 0) return 0
  const minKeep = Math.max(0, opts?.minKeep ?? MIN_KEEP_UNITS)
  // Leave at least one unit for the middle when there are 2+ units.
  const maxKeep = Math.min(n, opts?.maxKeep ?? Math.max(minKeep, n > 1 ? n - 1 : n))
  if (maxKeep <= 0) return 0

  let kept = 0
  let tokens = 0
  for (let i = n - 1; i >= 0; i--) {
    const count = Math.max(0, unitTokenCounts[i] ?? 0)
    if (kept >= minKeep && tokens + count > targetTokens) break
    if (kept >= maxKeep) break
    tokens += count
    kept += 1
  }
  return Math.max(minKeep, Math.min(kept, maxKeep))
}

/**
 * Message-budget for the keep tail after reserving fixed prompt overhead
 * (system + tools). Never below MIN_TARGET_KEEP_TOKENS.
 */
export function messageKeepTokenBudget(
  contextWindow: number,
  fixedOverheadTokens: number,
  targetPercent: number = TARGET_THRESHOLD_PERCENT,
): number {
  const total = targetKeepTokens(contextWindow, targetPercent)
  const residual = total - Math.max(0, fixedOverheadTokens)
  return Math.max(MIN_TARGET_KEEP_TOKENS, residual)
}
