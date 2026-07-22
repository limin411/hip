/** Compact token counts for dense chrome (composer chip, footers). */

export function formatTokensCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n < 1_000) return String(Math.round(n))
  if (n < 10_000) {
    const k = n / 1_000
    const s = k.toFixed(1)
    return `${s.endsWith('.0') ? s.slice(0, -2) : s}k`
  }
  if (n < 1_000_000) {
    return `${Math.round(n / 1_000)}k`
  }
  const m = n / 1_000_000
  const s = m.toFixed(1)
  return `${s.endsWith('.0') ? s.slice(0, -2) : s}M`
}
