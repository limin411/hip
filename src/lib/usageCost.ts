// src/lib/usageCost.ts
// Pure token→cost math for the chat usage footer/chip.
// UNIT ASSUMPTION: models.dev `CatalogModel.cost` ({ input, output }) is USD per 1,000,000 tokens.
// So dollars = (inTok × cost.input + outTok × cost.output) / 1_000_000  (P3-D6).

/** A models.dev price pair (CatalogModel.cost): USD per 1,000,000 tokens. */
export interface CostRate {
  input: number
  output: number
}

/** Minimal token shape we need — structurally compatible with protocol TurnUsage. */
export interface UsageTokens {
  inputTokens: number
  outputTokens: number
}

const PER = 1_000_000

/**
 * Dollar cost of a usage record at the given rate, or `null` when no rate is
 * available (token-only display). Never throws.
 */
export function computeCost(usage: UsageTokens, rate: CostRate | undefined): number | null {
  if (!rate) return null
  return (usage.inputTokens * rate.input + usage.outputTokens * rate.output) / PER
}

/** Compact USD formatter: 4 dp, with a `<$0.0001` floor for tiny non-zero costs and `$0.00` for zero. */
export function formatUsd(cost: number): string {
  if (cost === 0) return '$0.00'
  if (cost < 0.0001) return '<$0.0001'
  return `$${cost.toFixed(4)}`
}
