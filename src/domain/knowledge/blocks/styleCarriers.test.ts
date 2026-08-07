import { describe, expect, it } from 'vitest'
import { wrapStyledInlineForExport, wrapStyledText } from './styleCarriers'

describe('wrapStyledText', () => {
  it('wraps highlight in ==…==', () => {
    expect(wrapStyledText('hl', { highlight: true })).toBe('==hl==')
  })

  it('wraps textColor in span carrier', () => {
    expect(wrapStyledText('words', { textColor: 'red' })).toBe(
      '<span data-hip-color="red">words</span>',
    )
  })

  it('wraps backgroundColor in bg span carrier', () => {
    expect(wrapStyledText('mark', { backgroundColor: 'yellow' })).toBe(
      '<span data-hip-bg-color="yellow">mark</span>',
    )
  })

  it('nests bg outside color outside highlight', () => {
    expect(
      wrapStyledText('t', { highlight: true, textColor: 'red', backgroundColor: 'yellow' }),
    ).toBe('==<span data-hip-bg-color="yellow"><span data-hip-color="red">t</span></span>==')
  })

  it('escapes < & > inside span carriers', () => {
    expect(wrapStyledText('a <b> & c', { textColor: 'red' })).toBe(
      '<span data-hip-color="red">a &lt;b&gt; &amp; c</span>',
    )
  })

  it('leaves plain text untouched', () => {
    expect(wrapStyledText('plain', {})).toBe('plain')
    expect(wrapStyledText('plain', { textColor: 'default' })).toBe('plain')
  })
})

describe('wrapStyledInlineForExport', () => {
  it('wraps styled nodes and leaves plain text and code blocks alone', () => {
    const blocks = [
      {
        id: 'b1',
        type: 'paragraph',
        props: {},
        content: [
          { type: 'text', text: 'red ', styles: { textColor: 'red' } },
          { type: 'text', text: 'plain ', styles: {} },
          { type: 'text', text: 'hl ', styles: { highlight: true } },
        ],
        children: [],
      },
      {
        id: 'b2',
        type: 'codeBlock',
        props: {},
        content: 'raw **markdown** $not math$',
        children: [],
      },
      {
        id: 'b3',
        type: 'paragraph',
        props: {},
        content: [{ type: 'wikiLink', props: { title: 'X' }, content: undefined }],
        children: [],
      },
    ]
    const out = wrapStyledInlineForExport(blocks) as Array<{
      content: Array<{ text?: string; styles?: unknown }>
    }>
    expect(out[0]!.content.map((c) => c.text)).toEqual([
      '<span data-hip-color="red">red </span>',
      'plain ',
      '==hl ==',
    ])
    // Code block content (string) untouched; custom inline untouched.
    expect((out[1] as { content: unknown }).content).toBe(
      'raw **markdown** $not math$',
    )
    expect((out[2]!.content[0] as { type: string }).type).toBe('wikiLink')
  })

  it('does not mutate the input blocks', () => {
    const blocks = [
      {
        id: 'b1',
        type: 'paragraph',
        props: {},
        content: [{ type: 'text', text: 'x', styles: { textColor: 'red' } }],
        children: [],
      },
    ]
    wrapStyledInlineForExport(blocks)
    expect((blocks[0]!.content[0] as { text: string }).text).toBe('x')
  })

  it('wraps styled text inside table cells', () => {
    const blocks = [
      {
        id: 't1',
        type: 'table',
        props: {},
        content: {
          type: 'tableContent',
          rows: [
            { cells: [[{ type: 'text', text: 'cell', styles: { textColor: 'red' } }]] },
          ],
        },
        children: [],
      },
    ]
    const out = wrapStyledInlineForExport(blocks) as Array<{
      content: { rows: Array<{ cells: Array<Array<{ text?: string }>> }> }
    }>
    expect(out[0]!.content.rows[0]!.cells[0]![0]!.text).toBe(
      '<span data-hip-color="red">cell</span>',
    )
  })
})
