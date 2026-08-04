/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import { EditorView } from '@milkdown/kit/prose/view'
import {
  blockAt,
  blockPlainText,
  deleteTopLevelBlock,
  deleteTopLevelRange,
  duplicateTopLevelBlock,
  insertEmptyParagraphNear,
  topLevelBlockAt,
  topLevelIndexRange,
} from './blockOps'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
      toDOM: (n) => ['h' + n.attrs.level, 0],
      parseDOM: [
        { tag: 'h1', attrs: { level: 1 } },
        { tag: 'h2', attrs: { level: 2 } },
      ],
    },
    text: { group: 'inline' },
    list_item: {
      content: 'paragraph block*',
      defining: true,
      toDOM: () => ['li', 0],
      parseDOM: [{ tag: 'li' }],
    },
    bullet_list: {
      group: 'block',
      content: 'list_item+',
      toDOM: () => ['ul', 0],
      parseDOM: [{ tag: 'ul' }],
    },
  },
})

function makeView(nodes: ReturnType<typeof schema.node>[]): EditorView {
  const doc = schema.node('doc', null, nodes)
  const state = EditorState.create({ doc, schema })
  const place = document.createElement('div')
  document.body.appendChild(place)
  return new EditorView(place, { state })
}

describe('blockOps', () => {
  it('topLevelBlockAt finds heading', () => {
    const h = schema.node('heading', { level: 2 }, schema.text('Hi'))
    const p = schema.node('paragraph', null, schema.text('body'))
    const view = makeView([h, p])
    const b = topLevelBlockAt(view.state.doc, 1)
    expect(b?.node.type.name).toBe('heading')
    expect(b?.from).toBe(0)
    view.destroy()
  })

  it('deleteTopLevelBlock leaves empty para when last', () => {
    const p = schema.node('paragraph', null, schema.text('only'))
    const view = makeView([p])
    expect(deleteTopLevelBlock(view, 0)).toBe(true)
    expect(view.state.doc.childCount).toBe(1)
    expect(view.state.doc.firstChild?.textContent).toBe('')
    view.destroy()
  })

  it('duplicateTopLevelBlock inserts copy after', () => {
    const p = schema.node('paragraph', null, schema.text('a'))
    const p2 = schema.node('paragraph', null, schema.text('b'))
    const view = makeView([p, p2])
    expect(duplicateTopLevelBlock(view, 0)).toBe(true)
    expect(view.state.doc.childCount).toBe(3)
    expect(view.state.doc.child(0).textContent).toBe('a')
    expect(view.state.doc.child(1).textContent).toBe('a')
    expect(view.state.doc.child(2).textContent).toBe('b')
    view.destroy()
  })

  it('insertEmptyParagraphNear before', () => {
    const p = schema.node('paragraph', null, schema.text('x'))
    const view = makeView([p])
    const at = insertEmptyParagraphNear(view, 0, -1)
    expect(at).toBe(0)
    expect(view.state.doc.childCount).toBe(2)
    expect(view.state.doc.child(0).textContent).toBe('')
    view.destroy()
  })

  it('blockPlainText for heading', () => {
    const h = schema.node('heading', { level: 2 }, schema.text('Title'))
    expect(blockPlainText(h)).toBe('## Title')
  })

  it('blockAt prefer list_item when nested', () => {
    const li = schema.node('list_item', null, [
      schema.node('paragraph', null, schema.text('item')),
    ])
    const ul = schema.node('bullet_list', null, [li])
    const view = makeView([ul])
    // pos inside list item text
    const inside = 3
    const nested = blockAt(view.state.doc, inside, { prefer: 'list_item' })
    expect(nested?.node.type.name).toBe('list_item')
    expect(nested?.depth).toBeGreaterThan(1)
    const top = blockAt(view.state.doc, inside, { prefer: 'top' })
    expect(top?.node.type.name).toBe('bullet_list')
    expect(top?.depth).toBe(1)
    view.destroy()
  })

  it('deleteTopLevelRange and topLevelIndexRange', () => {
    const view = makeView([
      schema.node('paragraph', null, schema.text('a')),
      schema.node('paragraph', null, schema.text('b')),
      schema.node('paragraph', null, schema.text('c')),
    ])
    const r = topLevelIndexRange(view.state.doc, 1, 5)
    expect(r).toEqual({ fromIndex: 0, toIndex: 1 })
    expect(deleteTopLevelRange(view, 0, 1)).toBe(true)
    expect(view.state.doc.childCount).toBe(1)
    expect(view.state.doc.firstChild?.textContent).toBe('c')
    view.destroy()
  })
})
