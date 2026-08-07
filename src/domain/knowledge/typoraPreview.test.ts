// @vitest-environment happy-dom
/**
 * Typora-style live preview decoration builder — pure unit tests.
 * Verifies rendered marks/replaces per element + reveal-on-caret behavior.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import {
  buildTyporaDecorations,
  collectTyporaDecorations,
  typoraLivePreview,
  TYPORA_MAX_DECORATED_CHARS,
  type TyporaDecorationRecord,
} from './typoraPreview'

function decorate(
  md: string,
  cursor = md.length,
): TyporaDecorationRecord[] {
  const state = EditorState.create({ doc: md, extensions: [markdownLanguage] })
  return collectTyporaDecorations(buildTyporaDecorations(state, cursor))
}

function marksOf(recs: TyporaDecorationRecord[], cls: string) {
  return recs.filter((r) => r.kind === 'mark' && r.cls === cls)
}

describe('buildTyporaDecorations', () => {
  it('hides ATX heading marker and styles content by level', () => {
    const recs = decorate('# Title\n\n## Sub')
    const h1 = marksOf(recs, 'kb-tp-h1')
    expect(h1).toHaveLength(1)
    expect(h1[0]).toMatchObject({ from: 0, to: 7 }) // whole heading incl. hidden `# `
    const h1marker = recs.filter((r) => r.kind === 'replace' && r.hidden)
    expect(h1marker.some((r) => r.from === 0 && r.to === 2)).toBe(true)
    expect(marksOf(recs, 'kb-tp-h2')).toHaveLength(1)
  })

  it('reveals raw heading syntax when caret is inside it', () => {
    const recs = decorate('# Title', 5) // caret in the heading text
    expect(marksOf(recs, 'kb-tp-h1')).toHaveLength(0)
    expect(recs.filter((r) => r.kind === 'replace')).toHaveLength(0)
  })

  it('renders bold/italic/strikethrough and hides their markers', () => {
    const recs = decorate('**bold** *it* ~~strike~~')
    const bold = marksOf(recs, 'kb-tp-strong')
    expect(bold).toHaveLength(1)
    expect(bold[0]!.from).toBe(2)
    expect(bold[0]!.to).toBe(6)
    expect(marksOf(recs, 'kb-tp-em')[0]).toMatchObject({ from: 10, to: 12 })
    const strike = marksOf(recs, 'kb-tp-strike')
    expect(strike).toHaveLength(1)
    // `**`, `*`, `~~` markers hidden
    const hidden = recs.filter((r) => r.kind === 'replace' && r.hidden)
    expect(hidden).toHaveLength(6)
  })

  it('reveals raw emphasis when caret is inside it', () => {
    const recs = decorate('**bold**', 4)
    expect(marksOf(recs, 'kb-tp-strong')).toHaveLength(0)
  })

  it('renders inline code chips', () => {
    const recs = decorate('`code`')
    const code = marksOf(recs, 'kb-tp-code')
    expect(code).toHaveLength(1)
    expect(code[0]!.from).toBe(1)
    expect(code[0]!.to).toBe(5)
    expect(recs.filter((r) => r.kind === 'replace' && r.hidden)).toHaveLength(2)
  })

  it('renders links: label styled, brackets and URL hidden', () => {
    const recs = decorate('[text](https://x.com)')
    const link = marksOf(recs, 'kb-tp-link')
    expect(link).toHaveLength(1)
    expect(link[0]).toMatchObject({ from: 1, to: 5 })
    const hidden = recs.filter((r) => r.kind === 'replace' && r.hidden)
    expect(hidden.some((r) => r.from === 0 && r.to === 1)).toBe(true) // '['
    expect(hidden.some((r) => r.from === 5 && r.to === 21)).toBe(true) // '](url)'
  })

  it('renders unordered/ordered list markers as widgets', () => {
    const recs = decorate('- a\n- b\n\n1. x\n2. y')
    const bullets = recs.filter((r) => r.kind === 'replace' && r.widget === 'BulletWidget')
    expect(bullets).toHaveLength(2)
    expect(bullets[0]!.from).toBe(0)
    const nums = recs.filter((r) => r.kind === 'replace' && r.widget === 'OrderedNumberWidget')
    expect(nums).toHaveLength(2)
    expect(nums[0]!.from).toBe(9)
  })

  it('renders task checkboxes with checked state', () => {
    const recs = decorate('- [ ] todo\n- [x] done')
    const boxes = recs.filter((r) => r.kind === 'replace' && r.widget === 'TaskCheckboxWidget')
    expect(boxes).toHaveLength(2)
    expect(boxes[0]).toMatchObject({ from: 2, to: 5 })
    expect(boxes[1]).toMatchObject({ from: 13, to: 16 })
  })

  it('renders blockquotes with per-line rail and hides > markers', () => {
    const recs = decorate('> quote\n> second')
    expect(marksOf(recs, 'kb-tp-quote')).toHaveLength(1)
    const hidden = recs.filter((r) => r.kind === 'replace' && r.hidden)
    expect(hidden.some((r) => r.from === 0 && r.to === 2)).toBe(true)
    expect(hidden.some((r) => r.from === 8 && r.to === 10)).toBe(true)
  })

  it('renders code fences with language chip and hides fence lines', () => {
    const recs = decorate('```ts\nconst x = 1\n```')
    const label = recs.filter((r) => r.kind === 'replace' && r.widget === 'FenceLabelWidget')
    expect(label).toHaveLength(1)
    expect(label[0]).toMatchObject({ from: 0, to: 5 }) // ``` + ts
    const fence = marksOf(recs, 'kb-tp-fence')
    expect(fence).toHaveLength(1)
    expect(fence[0]).toMatchObject({ from: 6, to: 17 }) // code text
    const hidden = recs.filter((r) => r.kind === 'replace' && r.hidden)
    expect(hidden.some((r) => r.from === 18 && r.to === 21)).toBe(true) // closing ```
  })

  it('reveals raw fence when caret is inside the code', () => {
    const recs = decorate('```\nx\n```', 3)
    expect(marksOf(recs, 'kb-tp-fence')).toHaveLength(0)
  })

  it('renders horizontal rules as divider widgets', () => {
    const recs = decorate('a\n\n---\n\nb')
    const hr = recs.filter((r) => r.kind === 'replace' && r.widget === 'HrWidget')
    expect(hr).toHaveLength(1)
    expect(hr[0]).toMatchObject({ from: 3, to: 6 })
  })

  it('styles wiki links inside paragraphs', () => {
    const recs = decorate('see [[Note]] and [[#Sec]] here')
    const wiki = marksOf(recs, 'kb-tp-wiki')
    expect(wiki).toHaveLength(2)
    expect(wiki[0]).toMatchObject({ from: 4, to: 12 })
    expect(wiki[1]).toMatchObject({ from: 17, to: 25 })
  })

  it('reveals raw wiki link when caret is inside it', () => {
    const recs = decorate('[[Note]]', 3)
    expect(marksOf(recs, 'kb-tp-wiki')).toHaveLength(0)
  })

  it('renders inline images as image widgets', () => {
    const recs = decorate('![alt](assets/a.png)')
    const img = recs.filter((r) => r.kind === 'replace' && r.widget === 'ImageWidget')
    expect(img).toHaveLength(1)
    expect(img[0]).toMatchObject({ from: 0, to: 20 })
  })

  it('skips decorations for oversized docs (plain source)', () => {
    const state = EditorState.create({
      doc: 'x'.repeat(TYPORA_MAX_DECORATED_CHARS + 10),
      extensions: [markdownLanguage],
    })
    const set = buildTyporaDecorations(state, 0)
    expect(collectTyporaDecorations(set)).toHaveLength(0)
  })
})

describe('typoraLivePreview plugin', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('mounts in a real view, decorates the doc, and reacts to the caret', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const plugin = typoraLivePreview()
    const view = new EditorView({
      doc: '# Title\n\n**bold**',
      parent: host,
      extensions: [markdownLanguage, plugin],
    })
    // Plugin instance is reachable through the view; decorations exist for h1.
    const instance = view.plugin(plugin as never)
    expect(instance).toBeTruthy()
    const set = (instance as { decorations: DecorationSet }).decorations
    const recs = collectTyporaDecorations(set)
    expect(recs.some((r) => r.kind === 'mark' && r.cls === 'kb-tp-h1')).toBe(true)
    expect(recs.some((r) => r.kind === 'mark' && r.cls === 'kb-tp-strong')).toBe(true)

    // Caret inside the heading → raw syntax reveals (h1 mark disappears).
    view.dispatch({ selection: { anchor: 3 } })
    const after = collectTyporaDecorations(
      (instance as { decorations: DecorationSet }).decorations,
    )
    expect(after.some((r) => r.kind === 'mark' && r.cls === 'kb-tp-h1')).toBe(false)
    // Bold outside the caret still renders.
    expect(after.some((r) => r.kind === 'mark' && r.cls === 'kb-tp-strong')).toBe(true)
    view.destroy()
  })

  it('renders a realistic mixed document and never touches the doc text', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const doc = [
      '# Big Title',
      '',
      'Intro with **bold**, *it*, `code`, [link](https://x), [[Note]] and ![alt](assets/p.png)',
      '',
      '## Section',
      '',
      '- item one',
      '- [ ] todo item',
      '- [x] done item',
      '',
      '1. first',
      '2. second',
      '',
      '> quote line',
      '> second line',
      '',
      '```ts',
      'const a: number = 1',
      '```',
      '',
      '---',
      '',
      'fin.',
    ].join('\n')
    const view = new EditorView({
      doc,
      parent: host,
      extensions: [markdownLanguage, typoraLivePreview()],
    })
    const html = host.querySelector('.cm-content')?.innerHTML ?? ''
    for (const cls of [
      'kb-tp-h1',
      'kb-tp-strong',
      'kb-tp-code',
      'kb-tp-link',
      'kb-tp-wiki',
      'kb-tp-bullet',
      'kb-tp-task',
      'kb-tp-list-num',
      'kb-tp-quote',
      'kb-tp-fence',
      'kb-tp-hr',
    ]) {
      expect(html).toContain(cls)
    }
    // Decorations are visual only — the document text is untouched.
    expect(view.state.doc.toString()).toBe(doc)
    view.destroy()
  })
})
