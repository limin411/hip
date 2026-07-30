import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { Schema } from '@milkdown/kit/prose/model'
import { canTurnIntoNarrow, liftOutOfBlockquote } from './turnInto'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: {
      content: 'inline*',
      group: 'block',
      attrs: { level: { default: 1 } },
      defining: true,
    },
    blockquote: { content: 'block+', group: 'block', defining: true },
    list_item: { content: 'paragraph block*', defining: true },
    bullet_list: { content: 'list_item+', group: 'block' },
    text: { group: 'inline' },
  },
})

describe('turnInto helpers', () => {
  it('canTurnIntoNarrow allows single paragraph', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('hi')]),
    ])
    const state = EditorState.create({
      doc,
      schema,
      selection: TextSelection.create(doc, 1, 3),
    })
    expect(canTurnIntoNarrow(state)).toBe(true)
  })

  it('canTurnIntoNarrow rejects list_item context', () => {
    const doc = schema.node('doc', null, [
      schema.node('bullet_list', null, [
        schema.node('list_item', null, [
          schema.node('paragraph', null, [schema.text('hi')]),
        ]),
      ]),
    ])
    const state = EditorState.create({
      doc,
      schema,
      selection: TextSelection.create(doc, 3, 5),
    })
    expect(canTurnIntoNarrow(state)).toBe(false)
  })

  it('liftOutOfBlockquote lifts quote content', () => {
    const doc = schema.node('doc', null, [
      schema.node('blockquote', null, [
        schema.node('paragraph', null, [schema.text('hi')]),
      ]),
    ])
    let state = EditorState.create({
      doc,
      schema,
      selection: TextSelection.create(doc, 2),
    })
    const ok = liftOutOfBlockquote(state, (tr) => {
      state = state.apply(tr)
    })
    expect(ok).toBe(true)
    expect(state.doc.firstChild?.type.name).toBe('paragraph')
  })
})
