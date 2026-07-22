import type { TurnUsage } from '@hip/protocol'

/** Best single-request context size from a usage report (prefers input). */
export function stepContextTokens(u: TurnUsage): number {
  if (u.contextTokens != null && u.contextTokens > 0) return u.contextTokens
  if ((u.inputTokens ?? 0) > 0) return u.inputTokens
  if ((u.totalTokens ?? 0) > 0) return u.totalTokens
  return (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
}

/** Fold one step's usage into an accumulator (immutable; undefined acc → seed).
 *  Billing fields sum; contextTokens tracks the **last** step's context size. */
export function addUsage(acc: TurnUsage | undefined, next: TurnUsage): TurnUsage {
  const nextCtx = stepContextTokens(next)
  if (!acc) {
    return {
      inputTokens: next.inputTokens,
      outputTokens: next.outputTokens,
      totalTokens: next.totalTokens,
      ...(nextCtx > 0 ? { contextTokens: nextCtx } : {}),
    }
  }
  return {
    inputTokens: acc.inputTokens + next.inputTokens,
    outputTokens: acc.outputTokens + next.outputTokens,
    totalTokens: acc.totalTokens + next.totalTokens,
    ...(nextCtx > 0
      ? { contextTokens: nextCtx }
      : acc.contextTokens != null && acc.contextTokens > 0
        ? { contextTokens: acc.contextTokens }
        : {}),
  }
}

/** Sum per-agent usages into the turn total. Returns undefined when nothing was reported.
 *  Billing fields sum; contextTokens is the **max** across agents (peak context pressure). */
export function sumUsage(parts: ReadonlyArray<TurnUsage | undefined>): TurnUsage | undefined {
  let out: TurnUsage | undefined
  for (const p of parts) {
    if (!p) continue
    if (!out) {
      const ctx = stepContextTokens(p)
      out = {
        inputTokens: p.inputTokens,
        outputTokens: p.outputTokens,
        totalTokens: p.totalTokens,
        ...(ctx > 0 ? { contextTokens: ctx } : {}),
      }
      continue
    }
    const ctx = stepContextTokens(p)
    const prevCtx = out.contextTokens ?? 0
    out = {
      inputTokens: out.inputTokens + p.inputTokens,
      outputTokens: out.outputTokens + p.outputTokens,
      totalTokens: out.totalTokens + p.totalTokens,
      ...(Math.max(prevCtx, ctx) > 0 ? { contextTokens: Math.max(prevCtx, ctx) } : {}),
    }
  }
  return out
}
