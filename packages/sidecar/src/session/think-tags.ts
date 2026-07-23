/**
 * Split model output that embeds chain-of-thought as `<think>…</think>`
 * (MiniMax OpenAI-compat default, and some other hosts) into reasoning vs text.
 *
 * Stream-safe: tags may span chunks. Incomplete open/close tag prefixes are held
 * until the next delta or flush.
 */

const OPEN = '<think>'
const CLOSE = '</think>'

export type ThinkTagSplit = { text: string; reasoning: string }

/** Longest suffix of `s` that is a proper prefix of `tag` (partial tag at end). */
function holdPartialTag(s: string, tag: string): { emit: string; hold: string } {
  const max = Math.min(s.length, tag.length - 1)
  for (let n = max; n > 0; n--) {
    if (tag.startsWith(s.slice(s.length - n))) {
      return { emit: s.slice(0, s.length - n), hold: s.slice(s.length - n) }
    }
  }
  return { emit: s, hold: '' }
}

/**
 * Incremental splitter for streamed text that may contain `<think>…</think>`.
 * Does not emit the tags themselves; body of the tag → reasoning, outside → text.
 */
export function createThinkTagStreamSplitter(): {
  push: (delta: string) => ThinkTagSplit
  flush: () => ThinkTagSplit
  /** Current mode (for tests). */
  mode: () => 'text' | 'think'
} {
  let mode: 'text' | 'think' = 'text'
  let hold = ''

  function push(delta: string): ThinkTagSplit {
    if (!delta) return { text: '', reasoning: '' }
    let s = hold + delta
    hold = ''
    let text = ''
    let reasoning = ''
    let i = 0

    while (i < s.length) {
      if (mode === 'text') {
        const openIdx = s.indexOf(OPEN, i)
        if (openIdx === -1) {
          const rest = s.slice(i)
          const { emit, hold: h } = holdPartialTag(rest, OPEN)
          text += emit
          hold = h
          break
        }
        text += s.slice(i, openIdx)
        mode = 'think'
        i = openIdx + OPEN.length
      } else {
        const closeIdx = s.indexOf(CLOSE, i)
        if (closeIdx === -1) {
          const rest = s.slice(i)
          const { emit, hold: h } = holdPartialTag(rest, CLOSE)
          reasoning += emit
          hold = h
          break
        }
        reasoning += s.slice(i, closeIdx)
        mode = 'text'
        i = closeIdx + CLOSE.length
      }
    }

    return { text, reasoning }
  }

  function flush(): ThinkTagSplit {
    if (!hold) return { text: '', reasoning: '' }
    const out: ThinkTagSplit =
      mode === 'think' ? { text: '', reasoning: hold } : { text: hold, reasoning: '' }
    hold = ''
    return out
  }

  return { push, flush, mode: () => mode }
}

/**
 * One-shot split of a complete string (non-streaming / final cleanup).
 * Unclosed `<think>` at end treats the remainder as reasoning.
 */
export function splitThinkTags(raw: string): ThinkTagSplit {
  if (!raw || !raw.includes(OPEN)) {
    return { text: raw, reasoning: '' }
  }
  const s = createThinkTagStreamSplitter()
  const a = s.push(raw)
  const b = s.flush()
  return {
    text: a.text + b.text,
    reasoning: a.reasoning + b.reasoning,
  }
}
