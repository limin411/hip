/**
 * Live (BlockNote) code highlighter regression tests.
 *
 * BN's prosemirror-highlight parser calls `loadLanguage` with a bare canonical
 * id string (e.g. 'typescript'). Shiki `core` cannot resolve strings — only
 * registration objects — and previously threw + corrupted the registry, so
 * Live code blocks never got syntax highlighting (Reader/chat were fine).
 */
import { describe, expect, it } from 'vitest'
import {
  __resetLiveCodeHighlighterForTests,
  createLiveCodeHighlighter,
  resolveLiveCodeShikiTheme,
} from './codeBlockHighlight'
import type { HighlighterCore } from 'shiki/core'

/**
 * BN's parser calls loadLanguage with a bare canonical id string; shiki core's
 * types don't include string keys (that's the bundled highlighter type), so
 * mirror the runtime contract with a cast.
 */
function loadByString(
  hl: HighlighterCore,
  lang: string,
): Promise<void> {
  return (hl.loadLanguage as (l: string) => Promise<void>)(lang)
}

describe('createLiveCodeHighlighter (BlockNote contract)', () => {
  it('loads a language from its canonical id string without throwing', async () => {
    __resetLiveCodeHighlighterForTests()
    const hl = await createLiveCodeHighlighter()
    await expect(loadByString(hl, 'typescript')).resolves.toBeUndefined()
    expect(hl.getLoadedLanguages()).toContain('typescript')
  })

  it('tokenizes with the resolved live theme after string load', async () => {
    __resetLiveCodeHighlighterForTests()
    const hl = await createLiveCodeHighlighter()
    await loadByString(hl, 'python')
    const { tokens } = hl.codeToTokens('def f(x: int) -> int:\n  return x + 1', {
      lang: 'python',
      theme: resolveLiveCodeShikiTheme(),
    })
    expect(tokens.length).toBeGreaterThan(0)
    const colors = tokens.flat().map((t) => t.color).filter(Boolean)
    expect(colors.length).toBeGreaterThan(0)
  })

  it('rejects unknown languages (prosemirror-highlight stops retrying)', async () => {
    __resetLiveCodeHighlighterForTests()
    const hl = await createLiveCodeHighlighter()
    await expect(loadByString(hl, 'definitely-not-a-lang')).rejects.toThrow()
  })
})
