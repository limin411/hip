/**
 * PR-09a spike: Milkdown kit GFM markdown round-trip fixtures.
 *
 * Does not wire Live UI. Documents serializer behavior for go/no-go.
 * See `src/components/knowledge/DocLiveEditor.spike.md`.
 *
 * Handoff (PR-09):
 * - Live `getMarkdown()` is a **canonicalizing** writer: raw style will rewrite
 *   on save (`*` lists, blank lines, table seps, `<url>`). Product must accept
 *   that churn (or make an explicit re-normalize-on-save decision).
 * - `normalizeMd` is for Source↔Live **comparison** / soft equality tests only —
 *   do **not** silently apply it as a save filter unless product asks.
 * - Never feed YAML frontmatter into the editor; split/join outside.
 *
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { getMarkdown } from '@milkdown/kit/utils'
import { normalizeMd } from './mdNormalize'

/** @deprecated Prefer `@/domain/knowledge/mdNormalize` — re-export for spike callers. */
export { normalizeMd }

async function roundTrip(md: string): Promise<string> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, md)
    })
    .use(commonmark)
    .use(gfm)
    .create()
  try {
    return editor.action(getMarkdown())
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const fixtures: Record<string, string> = {
  tasks: '- [ ] task\n- [x] done\n',
  tables: '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
  strike: 'This is ~~strike~~ text\n',
  fences: '```ts\nconst x = 1\n```\n',
  blockquote: '> quote line\n',
  lists: '- a\n- b\n\n1. one\n2. two\n',
  autolink: 'See https://example.com for more\n',
  cjk: '中文段落与 **粗体** 以及「引号」\n',
  empty: '',
  frontmatter: '---\ntags: [a, b]\nstatus: draft\n---\n\n# Body\n',
}

/**
 * Fixed raw serializer outputs for kit@7.21.3 (pin-upgrade tripwire).
 * Non-identity fixtures must match exactly so style drift fails CI.
 * Identity fixtures expect OUT === IN.
 */
const expectedRawOut: Record<string, string> = {
  tasks: '* [ ] task\n\n* [x] done\n',
  tables: '| a | b |\n| - | - |\n| 1 | 2 |\n',
  strike: 'This is ~~strike~~ text\n',
  fences: '```ts\nconst x = 1\n```\n',
  blockquote: '> quote line\n',
  lists: '* a\n\n* b\n\n1. one\n2. two\n',
  autolink: 'See <https://example.com> for more\n',
  cjk: '中文段落与 **粗体** 以及「引号」\n',
  empty: '',
  // Full observed corruption pattern (leading + closing fences, escapes):
  // leading --- → ***; YAML leaks as paragraphs; [ escaped; closing --- → long HR
  frontmatter: '***\n\ntags: \\[a, b]\nstatus: draft\n-------------\n\n# Body\n',
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Milkdown kit GFM round-trip (PR-09a spike)', () => {
  it.each(
    Object.entries(fixtures).filter(([name]) => name !== 'frontmatter'),
  )(
    'fixture %s: raw OUT matches pin snapshot and soft-equals under normalizeMd',
    async (name, md) => {
      const out = await roundTrip(md)
      // Pin tripwire: serializer style must not drift unnoticed on kit upgrade
      expect(out).toBe(expectedRawOut[name])
      // Soft equality (comparison UX only — not a save filter)
      expect(normalizeMd(out)).toBe(normalizeMd(md))
    },
    15_000,
  )

  it('frontmatter is NOT safe through editor — strip+re-prefix required', async () => {
    const md = fixtures.frontmatter
    const out = await roundTrip(md)
    // Full corruption snapshot (kit@7.21.3): both fences + escapes + body leak
    expect(out).toBe(expectedRawOut.frontmatter)
    expect(out).toContain('# Body')
    expect(out.startsWith('---\n')).toBe(false)
    expect(out).toMatch(/^\*\*\*/) // leading fence → thematic break
    expect(out).toContain('-------------') // closing fence → long HR
    expect(out).toContain('\\[a, b]') // YAML list brackets escaped
    expect(out).not.toBe(md)
  }, 15_000)

  it('normalizeMd unifies list/task markers and table seps (comparison only)', () => {
    expect(normalizeMd('* [ ] a\n* [X] b\n')).toBe('- [ ] a\n- [x] b\n')
    expect(normalizeMd('+ item\n')).toBe('- item\n')
    expect(normalizeMd('| a |\n| - |\n| 1 |\n')).toBe('| a |\n| --- |\n| 1 |\n')
    expect(normalizeMd('See <https://ex.com> x\n')).toBe('See https://ex.com x\n')
  })
})
