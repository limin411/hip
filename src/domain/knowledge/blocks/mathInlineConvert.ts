/**
 * Split plain block text into text / inline-math segments.
 * Pure function — used by the Live editor keyup auto-convert (`$…$` → chip).
 *
 * Same heuristics as `inlineMathMdToHtml` (carriers.ts):
 * opening `$` at start / after non-word non-`$` non-`\` char; src without
 * spaces at ends / `$` / newlines; closing `$` before end / whitespace /
 * punctuation (not a digit — "$5 and $10" stays text).
 */

export type InlineMathSegment =
  | { type: 'text'; text: string }
  | { type: 'mathInline'; src: string }

const INLINE_MATH_RE = /(^|[^\\$\w])[$]([^\s$][^$\n]*?)[$](?=$|[\s.,;:!?)\]}>-])/g

/** True when text contains at least one convertible `$…$` run. */
export function hasInlineMath(text: string): boolean {
  INLINE_MATH_RE.lastIndex = 0
  return INLINE_MATH_RE.test(text)
}

/** Split text; adjacent `$` runs each become their own math segment. */
export function splitInlineMath(text: string): InlineMathSegment[] {
  const out: InlineMathSegment[] = []
  INLINE_MATH_RE.lastIndex = 0
  let last = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_MATH_RE.exec(text))) {
    const lead = m[1] ?? ''
    const start = m.index + lead.length
    const end = m.index + m[0].length
    if (start > last) out.push({ type: 'text', text: text.slice(last, start) })
    out.push({ type: 'mathInline', src: m[2]!.trim() })
    last = end
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

/** Serialize segments back to plain text (for tests / diagnostics). */
export function segmentsToText(segments: InlineMathSegment[]): string {
  return segments
    .map((s) => (s.type === 'text' ? s.text : `$${s.src}$`))
    .join('')
}
