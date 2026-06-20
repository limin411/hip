// src/lib/normalizeMessageContent.ts

/** CJK Unified Ideographs + CJK punctuation / full-width forms (excludes fullwidth ASCII alphanumerics). */
const CJK_RE = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff5e\uff61-\uffef]/

/**
 * Common CJK sentence/clause punctuation that can stay attached to a single character.
 * Includes CJK curly quotes, corner brackets, fullwidth quotes, and standard CJK punctuation.
 */
const CJK_PUNCT_RE = /[\u3001-\u3003\u3008-\u3011\u3014-\u3015\uff08-\uff09\u2018-\u2019\u201c-\u201d\u300c-\u300d\u300e-\u300f\uff02\uff07\u2014\u2026\uff0c\uff0e\uff01\uff1f\uff1b\uff1a]/

const MAX_COLLAPSIBLE_LINE_LENGTH = 4
const MIN_COLLAPSIBLE_RUN_LENGTH = 5

/**
 * A line is treated as "collapsible" when it looks like a corrupted single-character
 * CJK emission: very short, and made up of CJK characters or CJK punctuation.
 * We deliberately avoid collapsing ASCII-only short lines (e.g. list markers like `- a`)
 * and lines longer than a few characters.
 */
function isCollapsibleLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_COLLAPSIBLE_LINE_LENGTH) return false
  for (const ch of trimmed) {
    if (!CJK_RE.test(ch) && !CJK_PUNCT_RE.test(ch)) return false
  }
  return true
}

/**
 * Collapse runs of single-character CJK lines back into paragraphs.
 * Only acts on runs of 5+ collapsible lines so normal short lines (titles,
 * single-word emphasis, etc.) are preserved.
 */
function normalizeProse(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let runStart = -1
  let runLength = 0

  const flushRun = () => {
    if (runLength >= MIN_COLLAPSIBLE_RUN_LENGTH) {
      out.push(lines.slice(runStart, runStart + runLength).map((l) => l.trim()).join(''))
    } else if (runStart !== -1) {
      out.push(...lines.slice(runStart, runStart + runLength))
    }
    runStart = -1
    runLength = 0
  }

  for (let i = 0; i < lines.length; i++) {
    if (isCollapsibleLine(lines[i])) {
      if (runStart === -1) runStart = i
      runLength++
      continue
    }

    flushRun()
    out.push(lines[i])
  }

  flushRun()
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
      const delim = fenceMatch[1][0]
      // Backtick-fence info strings cannot contain backticks (GFM); tilde fences may contain tildes.
      if (delim !== '`' || !rest.includes('`')) {
        flush()
        inFence = true
        fenceMarker = fenceMatch[1]
        currentType = 'fence'
        current.push(line)
        continue
      }
    }

    if (inFence) {
      const closeMatch = line.match(/^ {0,3}(`{3,}|~{3,})/)
      if (closeMatch) {
        const delim = fenceMarker[0]
        const matched = closeMatch[1]
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
 * Some models (especially after processing raw HTML via web_fetch) emit CJK text
 * with a newline between every character. ReactMarkdown renders each of those
 * lines as a paragraph, producing the "one character per line" vertical layout bug.
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
