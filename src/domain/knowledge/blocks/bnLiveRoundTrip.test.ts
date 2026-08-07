/**
 * @vitest-environment happy-dom
 *
 * Real BlockNote integration: Live parse + serialize must preserve hip dialect
 * (mermaid newlines, math fences, callouts, code fences). Carrier-only goldens
 * are not enough — BN 0.52.1 blocksToMarkdownLossy strips custom toExternalHTML.
 */
import { describe, expect, it } from 'vitest'
import { BlockNoteEditor } from '@blocknote/core'
import { knowledgeBlockSchema } from './schema'
import {
  detectDialectLoss,
  preParseMdForLive,
  serializeLiveDocumentToMd,
} from './dialectBridge'
import { normalizeMd } from '../mdNormalize'

function makeEditor() {
  return BlockNoteEditor.create({ schema: knowledgeBlockSchema })
}

function liveRoundTrip(md: string): string {
  const editor = makeEditor()
  const prepared = preParseMdForLive(md)
  const blocks = editor.tryParseMarkdownToBlocks(prepared)
  editor.replaceBlocks(editor.document, blocks)
  return serializeLiveDocumentToMd(editor)
}

describe('BN Live round-trip (real editor)', () => {
  it('preserves mermaid source newlines and fence', () => {
    const md = '```mermaid\nflowchart LR\n  A --> B\n  B --> C\n```\n'
    const back = liveRoundTrip(md)
    expect(back).toMatch(/```mermaid/)
    expect(back).toContain('A --> B')
    expect(back).toContain('B --> C')
    // Newlines must survive (collapsed source breaks complex diagrams)
    expect(back).toMatch(/flowchart LR\n\s*A --> B/)
    expect(detectDialectLoss(md, back)).toEqual([])
  })

  it('preserves math display fence', () => {
    const md = '$$\nx^{2} + y^{2} = z^{2}\n$$\n'
    const back = liveRoundTrip(md)
    expect(back).toMatch(/\$\$/)
    expect(back).toContain('x^{2}')
    expect(detectDialectLoss(md, back)).toEqual([])
  })

  it('preserves callout body newlines', () => {
    const md = '> [!tip] Title\n> line one\n> line two\n'
    const back = liveRoundTrip(md)
    expect(back).toMatch(/\[!tip\]/)
    expect(back.toLowerCase()).toContain('line one')
    expect(detectDialectLoss(md, back)).toEqual([])
  })

  it('preserves code block language + body', () => {
    const md = '```js\nconsole.log("hi")\nconst x = 1\n```\n'
    const back = liveRoundTrip(md)
    expect(back).toMatch(/```(?:js|javascript)/i)
    expect(back).toContain('console.log')
    expect(back).toContain('const x = 1')
  })

  it('mixed document: heading + mermaid + code + paragraph', () => {
    const md = [
      '# Title',
      '',
      '```mermaid',
      'sequenceDiagram',
      '  Alice->>Bob: Hello',
      '```',
      '',
      '```ts',
      'export const n = 1',
      '```',
      '',
      'done',
      '',
    ].join('\n')
    const back = liveRoundTrip(md)
    expect(normalizeMd(back)).toContain('Title')
    expect(back).toMatch(/```mermaid/)
    expect(back).toContain('Alice->>Bob')
    expect(back).toContain('export const n = 1')
    expect(back).toContain('done')
    expect(detectDialectLoss(md, back)).toEqual([])
  })

  it('text color survives Live HTML export path', () => {
    const editor = makeEditor()
    editor.replaceBlocks(editor.document, [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'red', styles: { textColor: 'red' } },
          { type: 'text', text: ' plain', styles: {} },
        ],
      } as never,
    ])
    const md = serializeLiveDocumentToMd(editor)
    expect(md).toContain('data-hip-color="red"')
    expect(md).toContain('red')
    expect(md).toContain('plain')
  })
})
