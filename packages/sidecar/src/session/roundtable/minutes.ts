import type { SpeechRecord, StageRecord } from './types.js'

const DEFAULT_MAX_CHARS = 6000

/** Rolling meeting minutes for advisors + chair. */
export function updateMinutes(
  prev: string,
  round: number,
  speeches: SpeechRecord[],
  stage: StageRecord,
  maxChars = DEFAULT_MAX_CHARS,
): string {
  const speechLines = speeches
    .map((s) => `- ${s.speaker}: ${clip(s.content, 400)}`)
    .join('\n')
  const block = [
    `### Round ${round}`,
    speechLines || '- (no speeches)',
    `Agreed: ${stage.agreed.join('; ') || '—'}`,
    `Open: ${stage.open.join('; ') || '—'}`,
    stage.earlyExit ? `Early exit: ${stage.earlyExitReason ?? 'yes'}` : '',
    stage.nextFocus ? `Next focus: ${stage.nextFocus}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const next = prev ? `${prev}\n\n${block}` : block
  return truncateMinutes(next, maxChars)
}

export function truncateMinutes(text: string, maxChars = DEFAULT_MAX_CHARS): string {
  if (text.length <= maxChars) return text
  // Keep the tail (most recent rounds).
  return `…(earlier minutes truncated)…\n${text.slice(text.length - maxChars)}`
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`
}
