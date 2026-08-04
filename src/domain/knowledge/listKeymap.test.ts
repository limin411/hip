import { describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { exitEmptyListItem, indentListItem, outdentListItem } from './listKeymap'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    bullet_list: {
      group: 'block',
      content: 'list_item+',
      toDOM: () => ['ul', 0],
      parseDOM: [{ tag: 'ul' }],
    },
    list_item: {
      content: 'paragraph block*',
      defining: true,
      toDOM: () => ['li', 0],
      parseDOM: [{ tag: 'li' }],
    },
    text: { group: 'inline' },
  },
})

describe('listKeymap exitEmptyListItem', () => {
  it('returns false outside list', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('x')),
    ])
    const state = EditorState.create({
      doc,
      schema,
      selection: TextSelection.create(doc, 1),
    })
    expect(exitEmptyListItem(state)).toBe(false)
  })

  it('lifts empty list item', () => {
    const emptyP = schema.node('paragraph')
    const filled = schema.node('paragraph', null, schema.text('a'))
    const doc = schema.node('doc', null, [
      schema.node('bullet_list', null, [
        schema.node('list_item', null, filled),
        schema.node('list_item', null, emptyP),
      ]),
    ])
    // pos inside second empty para
    let pos = 0
    doc.descendants((node, p) => {
      if (node === emptyP) pos = p + 1
    })
    let state = EditorState.create({
      doc,
      schema,
      selection: TextSelection.create(doc, pos),
    })
    const ok = exitEmptyListItem(state, (tr) => {
      state = state.apply(tr)
    })
    expect(ok).toBe(true)
    // After lift, should have a paragraph at top level
    const names: string[] = []
    state.doc.forEach((n) => names.push(n.type.name))
    expect(names).toContain('paragraph')
  })

  it('indent/outdent return false outside list', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('x')),
    ])
    const state = EditorState.create({
      doc,
      schema,
      selection: TextSelection.create(doc, 1),
    })
    expect(indentListItem(state)).toBe(false)
    expect(outdentListItem(state)).toBe(false)
  })
})
