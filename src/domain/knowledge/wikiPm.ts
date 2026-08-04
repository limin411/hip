/**
 * Live wiki link helpers: find [[title]] / [[title|alias]] ranges in a textblock.
 * Used by decoration plugin (Phase C) — MD remains source of truth.
 */
import { parseWikiLinkInner } from './wikiLink'

export type WikiRange = {
  /** Absolute doc from (inclusive). */
  from: number
  /** Absolute doc to (exclusive). */
  to: number
  title: string
  display: string | null
  raw: string
}

const WIKI_RE = /\[\[([^\]]+)\]\]/g
const EMBED_RE = /!\[\[([^\]]+)\]\]/g

/**
 * Scan a single text string for wiki links (not embeds).
 * `basePos` is the absolute doc position of the start of `text`.
 */
export function findWikiRangesInText(text: string, basePos: number): WikiRange[] {
  const out: WikiRange[] = []
  WIKI_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKI_RE.exec(text)) != null) {
    // Skip embeds: preceding '!' 
    if (m.index > 0 && text[m.index - 1] === '!') continue
    const raw = m[0]
    const inner = m[1] ?? ''
    const { title, display } = parseWikiLinkInner(inner)
    if (!title && !display) continue
    out.push({
      from: basePos + m.index,
      to: basePos + m.index + raw.length,
      title,
      display,
      raw,
    })
  }
  return out
}

export type EmbedRange = {
  from: number
  to: number
  title: string
  raw: string
}

/** Scan for ![[title]] embeds in plain text. */
export function findEmbedRangesInText(text: string, basePos: number): EmbedRange[] {
  const out: EmbedRange[] = []
  EMBED_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = EMBED_RE.exec(text)) != null) {
    const raw = m[0]
    const inner = m[1] ?? ''
    const { title } = parseWikiLinkInner(inner)
    if (!title) continue
    out.push({
      from: basePos + m.index,
      to: basePos + m.index + raw.length,
      title,
      raw,
    })
  }
  return out
}

/** Build wiki markdown token. */
export function formatWikiToken(title: string, display?: string | null): string {
  if (display && display.length > 0 && display !== title) {
    return `[[${title}|${display}]]`
  }
  return `[[${title}]]`
}
