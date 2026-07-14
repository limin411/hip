/**
 * GFM task-list helpers for knowledge preview write-back.
 * Operates on Markdown source; index order matches document-order checkboxes
 * rendered by remark-gfm (outside fenced code blocks).
 */

/** `- [ ]` / `* [x]` / `1. [X]` etc. Capture marker prefix, box content, rest of line. */
const TASK_LINE = /^(\s*(?:[-*+]|\d{1,9}\.)\s+)\[([ xX])\](.*)$/

/**
 * Toggle the Nth GFM task checkbox in `md` (0-based, document order).
 * Skips fenced code blocks. Returns original string if index is out of range.
 * Normalized markers use lowercase `x` when checked.
 */
export function toggleTaskAt(md: string, index: number): string {
  if (index < 0 || !Number.isFinite(index)) return md

  const lines = md.split('\n')
  let inFence = false
  let fenceMarker: string | null = null
  let found = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/)
    if (fence) {
      const ticks = fence[2]
      if (!inFence) {
        inFence = true
        fenceMarker = ticks
      } else if (
        fenceMarker &&
        ticks[0] === fenceMarker[0] &&
        ticks.length >= fenceMarker.length &&
        !fence[3].trim()
      ) {
        inFence = false
        fenceMarker = null
      }
      continue
    }
    if (inFence) continue

    const m = line.match(TASK_LINE)
    if (!m) continue
    if (found === index) {
      const checked = m[2].toLowerCase() === 'x'
      const next = checked ? ' ' : 'x'
      lines[i] = `${m[1]}[${next}]${m[3]}`
      return lines.join('\n')
    }
    found++
  }

  return md
}

/** Count GFM task items outside fenced code (same rules as toggleTaskAt). */
export function countTasks(md: string): number {
  const lines = md.split('\n')
  let inFence = false
  let fenceMarker: string | null = null
  let n = 0
  for (const line of lines) {
    const fence = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/)
    if (fence) {
      const ticks = fence[2]
      if (!inFence) {
        inFence = true
        fenceMarker = ticks
      } else if (
        fenceMarker &&
        ticks[0] === fenceMarker[0] &&
        ticks.length >= fenceMarker.length &&
        !fence[3].trim()
      ) {
        inFence = false
        fenceMarker = null
      }
      continue
    }
    if (inFence) continue
    if (TASK_LINE.test(line)) n++
  }
  return n
}
