/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import { EditorView } from '@milkdown/kit/prose/view'
import {
  blockPlainText,
  deleteTopLevelBlock,
  duplicateTopLevelBlock,
  insertEmptyParagraphNear,
  topLevelBlockAt,
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
})
