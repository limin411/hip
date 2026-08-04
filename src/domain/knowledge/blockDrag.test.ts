/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import { EditorView } from '@milkdown/kit/prose/view'
import { moveTopLevelBlock, resolveSourceBlock } from './blockDrag'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    text: { group: 'inline' },
  },
})

function makeView(texts: string[]): EditorView {
  const nodes = texts.map((t) => schema.node('paragraph', null, t ? schema.text(t) : undefined))
  const doc = schema.node('doc', null, nodes)
  const state = EditorState.create({ doc, schema })
  const place = document.createElement('div')
  document.body.appendChild(place)
  return new EditorView(place, { state })
}

describe('blockDrag', () => {
  it('resolveSourceBlock', () => {
    const view = makeView(['a', 'b'])
    const src = resolveSourceBlock(view.state.doc, 1)
    expect(src?.node.textContent).toBe('a')
    view.destroy()
  })

  it('moveTopLevelBlock after later sibling', () => {
    const view = makeView(['a', 'b', 'c'])
    const a = resolveSourceBlock(view.state.doc, 1)!
    // insert before c (index 2)
    const cFrom = a.to + view.state.doc.child(1).nodeSize
    expect(moveTopLevelBlock(view, a.from, a.to, cFrom)).toBe(true)
    const texts: string[] = []
    view.state.doc.forEach((n) => texts.push(n.textContent))
    expect(texts).toEqual(['b', 'a', 'c'])
    view.destroy()
  })

  it('moveTopLevelBlock to start', () => {
    const view = makeView(['a', 'b', 'c'])
    const bStart = view.state.doc.child(0).nodeSize
    const b = resolveSourceBlock(view.state.doc, bStart + 1)!
    expect(moveTopLevelBlock(view, b.from, b.to, 0)).toBe(true)
    const texts: string[] = []
    view.state.doc.forEach((n) => texts.push(n.textContent))
    expect(texts).toEqual(['b', 'a', 'c'])
    view.destroy()
  })

  it('no-op when insert equals sourceFrom', () => {
    const view = makeView(['a', 'b'])
    const a = resolveSourceBlock(view.state.doc, 1)!
    expect(moveTopLevelBlock(view, a.from, a.to, a.from)).toBe(false)
    view.destroy()
  })
})
