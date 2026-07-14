/**
 * PR-09 production Milkdown kit GFM markdown round-trip fixtures.
 *
 * Based on PR-09a spike (`mdRoundTrip.spike.test.ts`):
 * - Live `getMarkdown()` is a **canonicalizing** writer (raw style may rewrite).
 * - `normalizeMd` is for Source↔Live **comparison** only — not a save filter.
 * - Frontmatter: strip → Live(body) → join (never feed FM into the editor).
 *
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { getMarkdown } from '@milkdown/kit/utils'
import { joinYamlFrontmatter, splitYamlFrontmatter } from './frontmatter'
import { normalizeMd } from './mdNormalize'

async function roundTripBody(md: string): Promise<string> {
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

/** Full-doc path used by DocLiveEditor: strip FM → Live → re-prefix. */
async function liveEditorRoundTrip(fullMd: string): Promise<string> {
  const { fmText, body } = splitYamlFrontmatter(fullMd)
  const bodyOut = await roundTripBody(body)
  return joinYamlFrontmatter(fmText, bodyOut)
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
 * Body-only fixtures (no FM). Identity fixtures expect OUT === IN.
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
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Milkdown kit GFM round-trip (PR-09)', () => {
  it.each(
    Object.entries(fixtures).filter(([name]) => name !== 'frontmatter'),
  )(
    'fixture %s: raw OUT matches pin snapshot and soft-equals under normalizeMd',
    async (name, md) => {
      const out = await roundTripBody(md)
      expect(out).toBe(expectedRawOut[name])
      expect(normalizeMd(out)).toBe(normalizeMd(md))
    },
    15_000,
  )

  it('frontmatter strip → Live(body) → join preserves FM and soft-equals body', async () => {
    const md = fixtures.frontmatter
    const out = await liveEditorRoundTrip(md)
    expect(out.startsWith('---\ntags: [a, b]\nstatus: draft\n---\n')).toBe(true)
    expect(out).toContain('# Body')
    // Must not show kit corruption (*** HR / escaped YAML)
    expect(out).not.toMatch(/^\*\*\*/)
    expect(out).not.toContain('\\[a, b]')
    expect(out).not.toContain('-------------')
    const { fmText: outFm, body: outBody } = splitYamlFrontmatter(out)
    expect(outFm).toBe('---\ntags: [a, b]\nstatus: draft\n---')
    // Live may drop a single blank line after the fence; compare body content.
    const { body: inBody } = splitYamlFrontmatter(md)
    expect(normalizeMd(outBody.replace(/^\n+/, ''))).toBe(
      normalizeMd(inBody.replace(/^\n+/, '')),
    )
  }, 15_000)

  it('raw FM through Live still corrupts — strip is required (guard)', async () => {
    const out = await roundTripBody(fixtures.frontmatter)
    expect(out.startsWith('---\n')).toBe(false)
    expect(out).toMatch(/^\*\*\*/)
  }, 15_000)

  it('normalizeMd unifies list/task markers and table seps (comparison only)', () => {
    expect(normalizeMd('* [ ] a\n* [X] b\n')).toBe('- [ ] a\n- [x] b\n')
    expect(normalizeMd('+ item\n')).toBe('- item\n')
    expect(normalizeMd('| a |\n| - |\n| 1 |\n')).toBe('| a |\n| --- |\n| 1 |\n')
    expect(normalizeMd('See <https://ex.com> x\n')).toBe('See https://ex.com x\n')
  })
})
