// src/lib/normalizeMessageContent.ts

/** CJK Unified Ideographs + CJK punctuation / full-width forms (excludes fullwidth ASCII alphanumerics). */
const CJK_RE = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff5e\uff61-\uffef]/

/**
 * Common CJK sentence/clause punctuation that can stay attached to a single character.
 * Includes CJK curly quotes, corner brackets, fullwidth quotes, and standard CJK punctuation.
 */
const CJK_PUNCT_RE = /[\u3001-\u3003\u3008-\u3011\u3014-\u3015\uff08-\uff09\u2018-\u2019\u201c-\u201d\u300c-\u300d\u300e-\u300f\uff02\uff07\u2014\u2026\uff0c\uff0e\uff01\uff1f\uff1b\uff1a]/

const MAX_CJK_LINE_LENGTH = 4
const MIN_CJK_RUN_LENGTH = 2

/** Latin "one word per line" runs need a slightly higher bar so short intentional paragraphs stay. */
const MAX_LATIN_WORD_LENGTH = 32
const MIN_LATIN_RUN_LENGTH = 3

type LineKind = 'empty' | 'cjk' | 'latin' | 'other'

/**
 * Short CJK / CJK-punctuation lines from broken model emission (one char or short word per line).
 * Avoids ASCII list markers and longer intentional prose lines.
 */
function isCjkCollapsible(trimmed: string): boolean {
  if (trimmed.length === 0 || trimmed.length > MAX_CJK_LINE_LENGTH) return false
  for (const ch of trimmed) {
    if (!CJK_RE.test(ch) && !CJK_PUNCT_RE.test(ch)) return false
  }
  return true
}

/**
 * A single Latin token on its own line (optional trailing sentence punct).
 * Rejects markdown list markers, headings, and anything with internal whitespace.
 */
function isLatinWordCollapsible(trimmed: string): boolean {
  if (trimmed.length === 0 || trimmed.length > MAX_LATIN_WORD_LENGTH) return false
  if (/\s/.test(trimmed)) return false
  // Markdown structure — never collapse these into prose runs.
  if (/^([-*+]|\d+[.)])$/.test(trimmed)) return false
  if (/^#{1,6}$/.test(trimmed)) return false
  // One word / identifier, optional trailing punct (models often hard-break after each token).
  return /^[A-Za-z0-9][A-Za-z0-9'_-]*[.,!?;:]?$/.test(trimmed)
}

function classifyLine(line: string): LineKind {
  const trimmed = line.trim()
  if (trimmed.length === 0) return 'empty'
  if (isCjkCollapsible(trimmed)) return 'cjk'
  if (isLatinWordCollapsible(trimmed)) return 'latin'
  return 'other'
}

/**
 * Collapse runs of short broken-emission lines back into paragraphs.
 *
 * Handles both:
 * - single newlines between units (`让\n我\n先`)
 * - blank-line / paragraph breaks between units (`让\n\n我\n\n先`), which
 *   ReactMarkdown renders as separate `<p>` tags (the classic vertical stack)
 *
 * CJK units join with no separator; Latin words join with a space.
 * Empty lines only act as soft separators inside a run of the same kind.
 * Fenced code is handled by the caller (splitByFences) and never reaches here.
 */
function normalizeProse(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const kind = classifyLine(lines[i]!)
    if (kind !== 'cjk' && kind !== 'latin') {
      out.push(lines[i]!)
      i++
      continue
    }

    const runKind = kind
    const content: string[] = []
    // Indices of original lines that belong to this attempted run (content only).
    let lastContentIdx = i
    let j = i

    while (j < lines.length) {
      const k = classifyLine(lines[j]!)
      if (k === runKind) {
        content.push(lines[j]!.trim())
        lastContentIdx = j
        j++
        continue
      }
      if (k === 'empty') {
        // Absorb blank line(s) only when more of the same kind follows.
        let k2 = j + 1
        while (k2 < lines.length && classifyLine(lines[k2]!) === 'empty') k2++
        if (k2 < lines.length && classifyLine(lines[k2]!) === runKind) {
          j = k2
          continue
        }
        break
      }
      break
    }

    const minRun = runKind === 'cjk' ? MIN_CJK_RUN_LENGTH : MIN_LATIN_RUN_LENGTH
    if (content.length >= minRun) {
      const joiner = runKind === 'cjk' ? '' : ' '
      out.push(content.join(joiner))
      // Resume after the last content line so trailing blanks before unrelated
      // content remain as real paragraph breaks.
      i = lastContentIdx + 1
    } else {
      // Not enough evidence of corruption — keep the original lines verbatim.
      out.push(...lines.slice(i, lastContentIdx + 1))
      i = lastContentIdx + 1
    }
  }

  return out.join('\n')
}

interface Segment {
  type: 'prose' | 'fence'
  text: string
}

/**
 * Split content into prose and fenced-code-block segments.
 * Supports GFM backtick (```) and tilde (~~~) fences at the start of a line
 * with up to 3 spaces of indentation. Info strings are allowed; inline `` ``` ``
 * references that contain the delimiter later in the line are not treated as fences.
 */
function splitByFences(content: string): Segment[] {
  const lines = content.split('\n')
  const segments: Segment[] = []
  let inFence = false
  let fenceMarker = ''
  let current: string[] = []
  let currentType: 'prose' | 'fence' = 'prose'

  const flush = () => {
    if (current.length > 0) {
      segments.push({ type: currentType, text: current.join('\n') })
      current = []
    }
  }

  for (const line of lines) {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fenceMatch && !inFence) {
      const rest = line.slice(fenceMatch[0].length)
      const delim = fenceMatch[1]![0]
      // Backtick-fence info strings cannot contain backticks (GFM); tilde fences may contain tildes.
      if (delim !== '`' || !rest.includes('`')) {
        flush()
        inFence = true
        fenceMarker = fenceMatch[1]!
        currentType = 'fence'
        current.push(line)
        continue
      }
    }

    if (inFence) {
      const closeMatch = line.match(/^ {0,3}(`{3,}|~{3,})/)
      if (closeMatch) {
        const delim = fenceMarker[0]
        const matched = closeMatch[1]!
        const isOnlyDelim = matched.split('').every((ch) => ch === delim)
        if (isOnlyDelim && matched.length >= fenceMarker.length) {
          current.push(line)
          flush()
          inFence = false
          fenceMarker = ''
          currentType = 'prose'
          continue
        }
      }
    }

    current.push(line)
  }

  flush()
  return segments
}

/**
 * Defensive normalization for assistant message markdown content.
 *
 * Some models emit CJK (or Latin) text with a newline — or a blank paragraph
 * break — between every character/word. ReactMarkdown turns blank-separated
 * short lines into separate `<p>` tags, producing a vertical "one word per line"
 * layout. Single newlines inside a paragraph also insert awkward spaces between
 * CJK characters.
 *
 * This helper collapses those runs while leaving fenced code blocks untouched.
 */
export function normalizeMessageContent(content: string | null | undefined): string {
  if (!content) return ''
  // Normalize CRLF / legacy CR so line-based parsing works on any platform.
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return splitByFences(normalized)
    .map((seg) => (seg.type === 'prose' ? normalizeProse(seg.text) : seg.text))
    .join('\n')
}
