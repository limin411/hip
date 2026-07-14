import { describe, expect, it } from 'vitest'
import { resolveParentForNew } from './parentForNew'
import type { KnowledgeNode } from './types'

function n(
  partial: Partial<KnowledgeNode> & Pick<KnowledgeNode, 'id' | 'kind' | 'title'>,
): KnowledgeNode {
  return {
    parentId: null,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

const folder = n({ id: 'fld_1', kind: 'folder', title: 'F' })
const docInFolder = n({
  id: 'doc_child',
  kind: 'doc',
  title: 'Child',
  parentId: 'fld_1',
})
const rootDoc = n({ id: 'doc_root', kind: 'doc', title: 'Root' })
const nodes = [folder, docInFolder, rootDoc]

describe('resolveParentForNew', () => {
  it('returns folder id when tree focus is a folder', () => {
    expect(
      resolveParentForNew({
        treeFocusId: 'fld_1',
        activeDocId: 'doc_root',
        nodes,
      }),
    ).toBe('fld_1')
  })

  it('returns parent of focused doc (sibling create)', () => {
    expect(
      resolveParentForNew({
        treeFocusId: 'doc_child',
        activeDocId: 'doc_root',
        nodes,
      }),
    ).toBe('fld_1')
  })

  it('returns null for focused root doc', () => {
    expect(
      resolveParentForNew({
        treeFocusId: 'doc_root',
        activeDocId: null,
        nodes,
      }),
    ).toBeNull()
  })

  it('falls back to active doc parent when no focus', () => {
    expect(
      resolveParentForNew({
        treeFocusId: null,
        activeDocId: 'doc_child',
        nodes,
      }),
    ).toBe('fld_1')
  })

  it('returns null when no focus and no active doc', () => {
    expect(
      resolveParentForNew({
        treeFocusId: null,
        activeDocId: null,
        nodes,
      }),
    ).toBeNull()
  })

  it('ignores stale treeFocusId and falls back to active', () => {
    expect(
      resolveParentForNew({
        treeFocusId: 'missing',
        activeDocId: 'doc_child',
        nodes,
      }),
    ).toBe('fld_1')
  })
})
