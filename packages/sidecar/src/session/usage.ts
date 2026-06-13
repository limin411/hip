import type { TurnUsage } from '@hip/protocol'

/** Fold one step's usage into an accumulator (immutable; undefined acc → seed). */
export function addUsage(acc: TurnUsage | undefined, next: TurnUsage): TurnUsage {
  return acc
    ? {
        inputTokens: acc.inputTokens + next.inputTokens,
        outputTokens: acc.outputTokens + next.outputTokens,
        totalTokens: acc.totalTokens + next.totalTokens,
      }
    : { ...next }
}

/** Sum per-agent usages into the turn total. Returns undefined when nothing was reported. */
export function sumUsage(parts: ReadonlyArray<TurnUsage | undefined>): TurnUsage | undefined {
  let out: TurnUsage | undefined
  for (const p of parts) if (p) out = addUsage(out, p)
  return out
}
