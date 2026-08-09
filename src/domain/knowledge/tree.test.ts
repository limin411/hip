import { describe, it, expect } from 'vitest'
import {
  assertTreeInvariants,
  collectBoardIdsInSubtree,
  collectDocIdsInSubtree,
  collectLeafIdsInSubtree,
  filterNodesByTitle,
  filterTreeVisible,
  getPath,
  getPathTitles,
  insertNode,
  listChildren,
  moveNode,
  nextOrder,
  removeNodeSubtree,
  renameNode,
} from './tree'
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

describe('knowledge tree helpers', () => {
  const folder = n({ id: 'nod_folder001', kind: 'folder', title: '决策', order: 0 })
  const docA = n({
    id: 'doc_aaaaaaa1',
    kind: 'doc',
    title: '权限 v2',
    parentId: 'nod_folder001',
    order: 1,
  })
  const docB = n({
    id: 'doc_bbbbbbb2',
    kind: 'doc',
    title: 'FAQ',
    parentId: 'nod_folder001',
    order: 0,
  })
  const rootDoc = n({ id: 'doc_root0001', kind: 'doc', title: '概览', order: 1 })
  const boardA = n({
    id: 'brd_board0001',
    kind: 'board',
    title: '架构草图',
    parentId: 'nod_folder001',
    order: 2,
  })

  it('listChildren sorts by order then title', () => {
    const kids = listChildren([folder, docA, docB, rootDoc], 'nod_folder001')
    expect(kids.map((c) => c.id)).toEqual(['doc_bbbbbbb2', 'doc_aaaaaaa1'])
  })

  it('getPathTitles walks to root', () => {
    expect(getPathTitles([folder, docA], 'doc_aaaaaaa1')).toEqual(['决策', '权限 v2'])
  })

  it('getPath returns nodes by id (duplicate titles safe)', () => {
    const path = getPath([folder, docA], 'doc_aaaaaaa1')
    expect(path.map((p) => p.id)).toEqual(['nod_folder001', 'doc_aaaaaaa1'])
  })

  it('filterTreeVisible includes matches and ancestors', () => {
    const visible = filterTreeVisible([folder, docA, docB, rootDoc], 'faq')
    expect(visible).not.toBeNull()
    expect(visible!.has('doc_bbbbbbb2')).toBe(true)
    expect(visible!.has('nod_folder001')).toBe(true)
    expect(visible!.has('doc_aaaaaaa1')).toBe(false)
  })

  it('filterTreeVisible null when query empty', () => {
    expect(filterTreeVisible([folder], '  ')).toBeNull()
  })

  it('moveNode reparents and reorders', () => {
    const next = moveNode([folder, docA, docB, rootDoc], 'doc_bbbbbbb2', null, 0, 50)
    const moved = next.find((x) => x.id === 'doc_bbbbbbb2')!
    expect(moved.parentId).toBeNull()
    expect(moved.order).toBe(0)
    assertTreeInvariants(next)
  })

  it('moveNode toIndex boundaries: row head (0) / row tail (len) / beyond clamps', () => {
    const r1 = n({ id: 'doc_r0000001', kind: 'doc', title: 'R1', order: 0 })
    const r2 = n({ id: 'doc_r0000002', kind: 'doc', title: 'R2', order: 1 })
    const r3 = n({ id: 'doc_r0000003', kind: 'doc', title: 'R3', order: 2 })
    const nodes = [r1, r2, r3]
    // 拖到行首 → toIndex 0
    let next = moveNode(nodes, 'doc_r0000002', null, 0)
    expect(next.find((x) => x.id === 'doc_r0000002')!.order).toBe(0)
    // 拖到行尾 → toIndex = 兄弟数-1（调用方语义：目标行 index+1）
    next = moveNode(nodes, 'doc_r0000001', null, 2)
    expect(next.find((x) => x.id === 'doc_r0000001')!.order).toBe(2)
    // 越界 toIndex 收敛到末尾
    next = moveNode(nodes, 'doc_r0000001', null, 99)
    expect(next.find((x) => x.id === 'doc_r0000001')!.order).toBe(2)
    // 越界负数收敛到 0
    next = moveNode(nodes, 'doc_r0000001', null, -5)
    expect(next.find((x) => x.id === 'doc_r0000001')!.order).toBe(0)
    // 空层（空文件夹）：无 toIndex → 唯一子节点 order 0
    const emptyFolder = n({
      id: 'nod_empty001',
      kind: 'folder',
      title: '空',
      parentId: null,
      order: 9,
    })
    next = moveNode([emptyFolder, docA], 'doc_aaaaaaa1', 'nod_empty001')
    const moved = next.find((x) => x.id === 'doc_aaaaaaa1')!
    expect(moved.parentId).toBe('nod_empty001')
    expect(moved.order).toBe(0)
    assertTreeInvariants(next)
  })

  it('moveNode rejects cycle into descendant folder', () => {
    const child = n({
      id: 'nod_child0001',
      kind: 'folder',
      title: '子',
      parentId: 'nod_folder001',
      order: 2,
    })
    expect(() =>
      moveNode([folder, child], 'nod_folder001', 'nod_child0001', 0),
    ).toThrow(/descendant/)
  })

  it('moveNode rejects doc as parent', () => {
    expect(() =>
      moveNode([folder, docA, docB], 'doc_bbbbbbb2', 'doc_aaaaaaa1', 0),
    ).toThrow(/folder/)
  })

  it('collectDocIdsInSubtree includes nested docs', () => {
    expect(collectDocIdsInSubtree([folder, docA, docB], 'nod_folder001').sort()).toEqual(
      ['doc_aaaaaaa1', 'doc_bbbbbbb2'].sort(),
    )
  })

  it('collectBoardIdsInSubtree includes nested boards only', () => {
    expect(collectBoardIdsInSubtree([folder, docA, boardA], 'nod_folder001')).toEqual([
      'brd_board0001',
    ])
    expect(collectDocIdsInSubtree([folder, docA, boardA], 'nod_folder001')).toEqual(['doc_aaaaaaa1'])
  })

  it('collectLeafIdsInSubtree is doc ∪ board', () => {
    expect(collectLeafIdsInSubtree([folder, docA, boardA], 'nod_folder001').sort()).toEqual(
      ['brd_board0001', 'doc_aaaaaaa1'].sort(),
    )
  })

  it('insertNode appends immutably', () => {
    const next = insertNode([folder], docA)
    expect(next).toHaveLength(2)
    expect([folder]).toHaveLength(1)
  })

  it('renameNode updates title', () => {
    const next = renameNode([docA], 'doc_aaaaaaa1', '新标题', 99)
    expect(next[0].title).toBe('新标题')
    expect(next[0].updatedAt).toBe(99)
  })

  it('removeNodeSubtree removes descendants and collects doc/board/leaf ids', () => {
    const { nodes, removedDocIds, removedBoardIds, removedLeafIds } = removeNodeSubtree(
      [folder, docA, docB, boardA, rootDoc],
      'nod_folder001',
    )
    expect(nodes.map((x) => x.id)).toEqual(['doc_root0001'])
    expect(removedDocIds.sort()).toEqual(['doc_aaaaaaa1', 'doc_bbbbbbb2'].sort())
    expect(removedBoardIds).toEqual(['brd_board0001'])
    expect(removedLeafIds.sort()).toEqual(
      ['brd_board0001', 'doc_aaaaaaa1', 'doc_bbbbbbb2'].sort(),
    )
  })

  it('removeNodeSubtree on board leaf collects only that board', () => {
    const { nodes, removedDocIds, removedBoardIds, removedLeafIds } = removeNodeSubtree(
      [folder, docA, boardA, rootDoc],
      'brd_board0001',
    )
    expect(removedDocIds).toEqual([])
    expect(removedBoardIds).toEqual(['brd_board0001'])
    expect(removedLeafIds).toEqual(['brd_board0001'])
    expect(nodes.map((x) => x.id).sort()).toEqual(
      ['doc_aaaaaaa1', 'doc_root0001', 'nod_folder001'].sort(),
    )
  })

  it('nextOrder is max+1', () => {
    expect(nextOrder([folder, docA, docB], 'nod_folder001')).toBe(2)
    expect(nextOrder([], null)).toBe(0)
  })

  it('filterNodesByTitle is case-insensitive', () => {
    const hits = filterNodesByTitle([docA, docB], 'faq')
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('doc_bbbbbbb2')
  })

  it('filterTreeVisible matches board titles', () => {
    const visible = filterTreeVisible([folder, boardA], '架构')
    expect(visible).not.toBeNull()
    expect(visible!.has('brd_board0001')).toBe(true)
    expect(visible!.has('nod_folder001')).toBe(true)
  })

  it('assertTreeInvariants accepts valid tree including board', () => {
    expect(() => assertTreeInvariants([folder, docA, docB, rootDoc, boardA])).not.toThrow()
  })

  it('assertTreeInvariants rejects duplicate ids', () => {
    expect(() => assertTreeInvariants([docA, { ...docA }])).toThrow(/duplicate/)
  })

  it('assertTreeInvariants enforces kind ⇔ prefix', () => {
    expect(() =>
      assertTreeInvariants([
        n({ id: 'doc_wrongkind1', kind: 'board', title: 'bad' }),
      ]),
    ).toThrow(/prefix/)
    expect(() =>
      assertTreeInvariants([
        n({ id: 'brd_wrongkind1', kind: 'doc', title: 'bad' }),
      ]),
    ).toThrow(/prefix/)
    expect(() =>
      assertTreeInvariants([
        n({ id: 'nod_wrongkind1', kind: 'doc', title: 'bad' }),
      ]),
    ).toThrow(/prefix/)
  })
})
