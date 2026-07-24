import type { TurnUsage } from '@hip/protocol'

/** Best single-request context size from a usage report.
 *  Only input / explicit contextTokens count — never billing `totalTokens`.
 *  Some providers (MiniMax stream usage) report output-only totals with input=0;
 *  treating that total as context fill makes the composer meter stick at 0%. */
export function stepContextTokens(u: TurnUsage): number {
  if (u.contextTokens != null && u.contextTokens > 0) return u.contextTokens
  if ((u.inputTokens ?? 0) > 0) return u.inputTokens
  return 0
}

/**
 * Build TurnUsage from LangChain `usage_metadata` (+ optional chars/4 estimate when
 * the provider omits prompt tokens). Returns undefined when nothing usable.
 */
export function usageFromModelMetadata(
  u: {
    input_tokens?: number | null
    output_tokens?: number | null
    total_tokens?: number | null
  } | null | undefined,
  estimatedContextTokens?: number,
): TurnUsage | undefined {
  if (!u) return undefined
  const inputTokens = finiteOrZero(u.input_tokens)
  const outputTokens = finiteOrZero(u.output_tokens)
  const totalRaw = finiteOrZero(u.total_tokens)
  const totalTokens = totalRaw > 0 ? totalRaw : inputTokens + outputTokens
  // No token fields at all → skip (same as "no usage_metadata").
  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) return undefined

  let contextTokens = inputTokens > 0 ? inputTokens : 0
  if (contextTokens <= 0 && estimatedContextTokens != null && estimatedContextTokens > 0) {
    contextTokens = estimatedContextTokens
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(contextTokens > 0 ? { contextTokens } : {}),
  }
}

function finiteOrZero(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
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
