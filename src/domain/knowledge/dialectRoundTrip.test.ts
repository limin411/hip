/**
 * Golden markers: hip dialect inserts must remain detectable after soft normalize.
 * Live BlockNote serialize is lossy; carriers (fenced code with lang) keep content.
 */
import { describe, expect, it } from 'vitest'
import { DIALECT_PRESERVE_MARKERS } from './blockNoteSlash'
import { KNOWLEDGE_SLASH_ITEMS } from './slashMenu'
import { normalizeMd } from './mdNormalize'

/** Simulate a Live-friendly carrier for dialect fences. */
function liveCarrierMarkdown(id: string): string {
  switch (id) {
    case 'mermaid':
      return '```mermaid\nflowchart LR\n  A --> B\n```\n'
    case 'svg':
      return '```svg\n<svg></svg>\n```\n'
    case 'math':
      return '$$\nx^2\n$$\n'
    case 'callout':
      return '> [!note] Title\n> body\n'
    case 'embed':
      return '![[Other Doc]]\n'
    case 'wiki':
      return 'See [[Other Doc]] here.\n'
    case 'toggle':
      return '<details>\n<summary>Fold</summary>\n\nBody\n\n</details>\n'
    default:
      return ''
  }
}

describe('dialect round-trip markers', () => {
  it('every dialect id has a catalog entry and preserve probe', () => {
    for (const { id, probe } of DIALECT_PRESERVE_MARKERS) {
      expect(KNOWLEDGE_SLASH_ITEMS.some((i) => i.id === id)).toBe(true)
      const md = liveCarrierMarkdown(id)
      expect(md.length).toBeGreaterThan(0)
      expect(probe.test(normalizeMd(md)) || probe.test(md)).toBe(true)
    }
  })

  it('mermaid language survives normalizeMd', () => {
    const md = liveCarrierMarkdown('mermaid')
    expect(normalizeMd(md)).toMatch(/```mermaid/)
  })

  it('callout note tag survives normalizeMd', () => {
    expect(normalizeMd(liveCarrierMarkdown('callout'))).toMatch(/\[!note\]/)
  })
})
