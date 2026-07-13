import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { setAtxHeading, toggleLinePrefix, wrapSelection } from './mdEdit'

function stateWith(doc: string, from: number, to = from): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: from, head: to },
  })
}

describe('mdEdit', () => {
  it('wrapSelection wraps non-empty selection with bold markers', () => {
    const state = stateWith('hello world', 0, 5)
    const spec = wrapSelection(state, '**', '**')
    const tr = state.update(spec)
    expect(tr.state.doc.toString()).toBe('**hello** world')
  })

  it('wrapSelection inserts markers for empty selection', () => {
    const state = stateWith('ab', 1)
    const spec = wrapSelection(state, '**', '**')
    const tr = state.update(spec)
    expect(tr.state.doc.toString()).toBe('a****b')
  })

  it('toggleLinePrefix adds bullet to lines', () => {
    const state = stateWith('one\ntwo', 0, 7)
    const tr = state.update(toggleLinePrefix(state, '- '))
    expect(tr.state.doc.toString()).toBe('- one\n- two')
  })

  it('toggleLinePrefix removes prefix when all lines have it', () => {
    const state = stateWith('- one\n- two', 0, 11)
    const tr = state.update(toggleLinePrefix(state, '- '))
    expect(tr.state.doc.toString()).toBe('one\ntwo')
  })

  it('setAtxHeading sets H2', () => {
    const state = stateWith('Title', 0)
    const tr = state.update(setAtxHeading(state, 2))
    expect(tr.state.doc.toString()).toBe('## Title')
  })

  it('setAtxHeading replaces existing heading level', () => {
    const state = stateWith('# Title', 0)
    const tr = state.update(setAtxHeading(state, 3))
    expect(tr.state.doc.toString()).toBe('### Title')
  })
})
