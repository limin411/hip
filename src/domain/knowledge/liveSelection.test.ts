/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { Schema } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { knowledgeBubbleShouldShow } from './liveSelection'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+', toDOM: () => ['div', 0] as const },
    paragraph: {
      content: 'inline*',
      group: 'block',
      toDOM: () => ['p', 0] as const,
    },
    text: { group: 'inline' },
    code_block: {
      content: 'text*',
      group: 'block',
      code: true,
      defining: true,
      attrs: { language: { default: '' } },
      toDOM: () => ['pre', ['code', 0]] as const,
    },
  },
  marks: {
    strong: { toDOM: () => ['strong', 0] as const },
  },
})

function fakeView(
  state: EditorState,
  extras?: Partial<EditorView>,
): EditorView {
  return {
    state,
    composing: false,
    editable: true,
    ...extras,
  } as unknown as EditorView
}

describe('knowledgeBubbleShouldShow', () => {
  it('false for empty selection', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph')])
    const state = EditorState.create({ doc, schema })
    expect(knowledgeBubbleShouldShow(fakeView(state))).toBe(false)
  })

  it('true for non-empty text selection in paragraph', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('hello')]),
    ])
    let state = EditorState.create({ doc, schema })
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 6)),
    )
    expect(knowledgeBubbleShouldShow(fakeView(state))).toBe(true)
  })

  it('false inside code_block', () => {
    const doc = schema.node('doc', null, [
      schema.node('code_block', { language: 'ts' }, [schema.text('const x = 1')]),
    ])
    let state = EditorState.create({ doc, schema })
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 6)),
    )
    expect(knowledgeBubbleShouldShow(fakeView(state))).toBe(false)
  })

  it('false when menusOpen', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('hello')]),
    ])
    let state = EditorState.create({ doc, schema })
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 6)),
    )
    expect(knowledgeBubbleShouldShow(fakeView(state), { menusOpen: true })).toBe(
      false,
    )
  })

  it('false when composing', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('hello')]),
    ])
    let state = EditorState.create({ doc, schema })
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 6)),
    )
    expect(
      knowledgeBubbleShouldShow(fakeView(state, { composing: true })),
    ).toBe(false)
  })
})
