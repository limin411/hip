import type { JsonValue, Source, Unavailable } from '../system-context.js'

// ── Payload ───────────────────────────────────────────────────────────────────

export interface TokenBudgetSourcePayload {
  readonly text: string
  /** Remaining budget as a percentage (0–100). */
  readonly budget: number
  /** Already-used budget as a percentage (0–100). */
  readonly used: number
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface TokenBudgetSourceInput {
  readonly tokenBudgetPercent?: number
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

function renderTokenBudget(budget: number): string {
  if (budget <= 10) {
    return 'Your token budget is nearly exhausted. Finish quickly or compact the conversation.'
  }
  return `You have approximately ${budget}% of your token budget remaining.`
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
    return {
      text: stringField(j, 'text') || renderTokenBudget(budget),
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
      const budget = input.tokenBudgetPercent
      const used = 100 - budget
      return { text: renderTokenBudget(budget), budget, used }
    },
    baseline: (payload) => payload.text,
  }
}
