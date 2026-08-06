import type { JsonValue, Source, Unavailable } from '../system-context.js'

// ── Stability policy (PR-7a) ──────────────────────────────────────────────────
//
// Token-budget text is only injected when remaining < WARN_BELOW, and remaining %
// is floored into BUCKET_SIZE steps so tiny mid-turn drifts do not rewrite the
// ContextEpoch baseline / break prompt-cache prefixes.

/** Inject only when remaining budget is strictly below this percent. */
export const TOKEN_BUDGET_WARN_BELOW = 30
/** Remaining at or below this percent uses the critical "nearly exhausted" copy. */
export const TOKEN_BUDGET_CRITICAL_AT = 10
/** Display / snapshot buckets (e.g. 21–29 → 20). */
export const TOKEN_BUDGET_BUCKET_SIZE = 10

const CRITICAL_TEXT =
  'Your token budget is nearly exhausted. Finish quickly or compact the conversation.'

/** Stable idle payload when remaining is high enough not to inject. */
const IDLE_PAYLOAD: TokenBudgetSourcePayload = {
  text: '',
  budget: 100,
  used: 0,
}

// ── Payload ───────────────────────────────────────────────────────────────────

export interface TokenBudgetSourcePayload {
  readonly text: string
  /** Stabilized remaining budget as a percentage (0–100), bucketed when active. */
  readonly budget: number
  /** Already-used budget as a percentage (0–100), derived from stabilized budget. */
  readonly used: number
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface TokenBudgetSourceInput {
  readonly tokenBudgetPercent?: number
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Floor remaining % into a stable display bucket (10% steps by default). */
export function bucketTokenBudgetPercent(
  remaining: number,
  bucketSize: number = TOKEN_BUDGET_BUCKET_SIZE,
): number {
  if (!Number.isFinite(remaining)) return 0
  const clamped = Math.max(0, Math.min(100, remaining))
  const size = bucketSize > 0 ? bucketSize : TOKEN_BUDGET_BUCKET_SIZE
  return Math.floor(clamped / size) * size
}

/** Whether the model-visible token-budget fragment should be present. */
export function shouldInjectTokenBudget(remaining: number): boolean {
  return Number.isFinite(remaining) && remaining < TOKEN_BUDGET_WARN_BELOW
}

/**
 * Model-visible token-budget copy.
 * - remaining >= 30 → empty (do not inject)
 * - remaining <= 10 → critical warning (one stable zone)
 * - else → "approximately N%" with N floored to 10% buckets
 */
export function renderTokenBudget(remaining: number): string {
  if (!shouldInjectTokenBudget(remaining)) return ''
  if (remaining <= TOKEN_BUDGET_CRITICAL_AT) return CRITICAL_TEXT
  const bucketed = bucketTokenBudgetPercent(remaining)
  return `You have approximately ${bucketed}% of your token budget remaining.`
}

/**
 * Stabilize raw remaining % into a snapshot-friendly payload.
 * All values in the same zone/bucket share identical JSON encoding so
 * SystemContext.reconcile stays Unchanged across tiny drifts.
 */
export function stabilizeTokenBudget(remaining: number): TokenBudgetSourcePayload {
  if (!shouldInjectTokenBudget(remaining)) {
    return IDLE_PAYLOAD
  }
  if (remaining <= TOKEN_BUDGET_CRITICAL_AT) {
    return { text: CRITICAL_TEXT, budget: TOKEN_BUDGET_CRITICAL_AT, used: 100 - TOKEN_BUDGET_CRITICAL_AT }
  }
  const budget = bucketTokenBudgetPercent(remaining)
  return {
    text: `You have approximately ${budget}% of your token budget remaining.`,
    budget,
    used: 100 - budget,
  }
}

// ── Codec ─────────────────────────────────────────────────────────────────────

function isObject(j: JsonValue): j is { readonly [key: string]: JsonValue } {
  return typeof j === 'object' && j !== null && !Array.isArray(j)
}

function stringField(j: { readonly [key: string]: JsonValue }, key: string): string {
  const value = j[key]
  return typeof value === 'string' ? value : ''
}

function numberField(j: { readonly [key: string]: JsonValue }, key: string): number {
  const value = j[key]
  return typeof value === 'number' ? value : 0
}

const codec = {
  encode(a: TokenBudgetSourcePayload): JsonValue {
    return {
      text: a.text,
      budget: a.budget,
      used: a.used,
    }
  },
  decode(j: JsonValue): TokenBudgetSourcePayload {
    if (!isObject(j)) {
      return { text: '', budget: 0, used: 0 }
    }
    const budget = numberField(j, 'budget')
    const text = stringField(j, 'text')
    return {
      text: text || (budget < TOKEN_BUDGET_WARN_BELOW ? renderTokenBudget(budget) : ''),
      budget,
      used: numberField(j, 'used'),
    }
  },
}

// ── Source ────────────────────────────────────────────────────────────────────

export function createTokenBudgetSource(
  input: TokenBudgetSourceInput,
): Source<TokenBudgetSourcePayload> {
  return {
    key: 'fragment:token-budget',
    codec,
    load: async () => {
      if (input.tokenBudgetPercent === undefined) {
        return { _tag: 'Unavailable', reason: 'token budget is not set' } as Unavailable
      }
      return stabilizeTokenBudget(input.tokenBudgetPercent)
    },
    baseline: (payload) => payload.text,
  }
}
