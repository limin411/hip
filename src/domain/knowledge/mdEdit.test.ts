// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  applySlashInsert,
  insertHr,
  insertTableSkeleton,
  insertWikiLink,
  setAtxHeading,
  toggleLinePrefix,
  wrapSelection,
} from './mdEdit'
import { TABLE_SKELETON_3X2 } from './slashMenu'

function stateWith(doc: string, from: number, to = from): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: from, head: to },
  })
}

function viewWith(doc: string, from: number, to = from): EditorView {
  const parent = document.createElement('div')
  return new EditorView({
    state: stateWith(doc, from, to),
    parent,
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

  it('applySlashInsert replaces token and places cursor', () => {
    const view = viewWith('/h1', 3)
    expect(applySlashInsert(view, 0, 3, '# ', 2)).toBe(true)
    expect(view.state.doc.toString()).toBe('# ')
    expect(view.state.selection.main.head).toBe(2)
    view.destroy()
  })

  it('insertTableSkeleton fills empty line with 3×2 skeleton', () => {
    const view = viewWith('', 0)
    expect(insertTableSkeleton(view, TABLE_SKELETON_3X2)).toBe(true)
    expect(view.state.doc.toString()).toBe(TABLE_SKELETON_3X2)
    expect(view.state.selection.main.head).toBe(2)
    view.destroy()
  })

  it('insertWikiLink wraps selection', () => {
    const view = viewWith('Page', 0, 4)
    expect(insertWikiLink(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('[[Page]]')
    view.destroy()
  })

  it('insertWikiLink inserts empty brackets for empty selection', () => {
    const view = viewWith('ab', 1)
    expect(insertWikiLink(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('a[[]]b')
    expect(view.state.selection.main.head).toBe(3)
    view.destroy()
  })

  it('insertHr fills empty line', () => {
    const view = viewWith('', 0)
    expect(insertHr(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('---\n')
    view.destroy()
  })

  it('insertHr appends after non-empty line', () => {
    const view = viewWith('hello', 5)
    expect(insertHr(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('hello\n---\n')
    view.destroy()
  })
})
