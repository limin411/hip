import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { wikiLinkCompletionSource } from './wikiCmCompletion'
import type { KnowledgeNode } from './types'

const nodes: KnowledgeNode[] = [
  {
    id: 'doc_a',
    parentId: null,
    kind: 'doc',
    title: 'Alpha',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'doc_b',
    parentId: null,
    kind: 'doc',
    title: 'Alpine',
    order: 1,
    createdAt: 1,
    updatedAt: 1,
  },
]

describe('wikiLinkCompletionSource', () => {
  it('returns ranked options for open [[ query', () => {
    const state = EditorState.create({ doc: 'See [[Alp' })
    const source = wikiLinkCompletionSource(() => nodes)
    const result = source({
      state,
      pos: state.doc.length,
      explicit: false,
      matchBefore: () => null,
      aborted: false,
      tokenBefore: () => null,
    } as never)
    expect(result).not.toBeNull()
    expect(result!.from).toBe(6)
    expect(result!.options.map((o) => o.label)).toEqual(
      expect.arrayContaining(['Alpha', 'Alpine']),
    )
  })

  it('returns null outside wiki context', () => {
    const state = EditorState.create({ doc: 'plain text' })
    const source = wikiLinkCompletionSource(() => nodes)
    const result = source({
      state,
      pos: 5,
      explicit: false,
      matchBefore: () => null,
      aborted: false,
      tokenBefore: () => null,
    } as never)
    expect(result).toBeNull()
  })
})
