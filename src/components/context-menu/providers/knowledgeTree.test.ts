import { describe, it, expect, vi } from 'vitest'
import { knowledgeTreeProvider } from './knowledgeTree'
import type { ContextMenuBuildContext } from '../types'

const ctx = {
  t: ((k: string) => k) as ContextMenuBuildContext['t'],
  isMac: true,
} as ContextMenuBuildContext

describe('knowledgeTreeProvider', () => {
  it('returns root create actions including whiteboard', () => {
    const onNewDoc = vi.fn()
    const onNewBoard = vi.fn()
    const onNewFolder = vi.fn()
    const items = knowledgeTreeProvider(
      {
        kind: 'knowledgeTree',
        payload: { onNewDoc, onNewBoard, onNewFolder },
      },
      ctx,
    )
    expect(items.map((i) => i.id)).toEqual([
      'knowledgeTree.newDoc',
      'knowledgeTree.newBoard',
      'knowledgeTree.newFolder',
    ])
    items.find((i) => i.id === 'knowledgeTree.newDoc')!.run()
    items.find((i) => i.id === 'knowledgeTree.newBoard')!.run()
    items.find((i) => i.id === 'knowledgeTree.newFolder')!.run()
    expect(onNewDoc).toHaveBeenCalled()
    expect(onNewBoard).toHaveBeenCalled()
    expect(onNewFolder).toHaveBeenCalled()
    expect(items.find((i) => i.id === 'knowledgeTree.newBoard')!.label).toBe(
      'knowledge.tree.newBoard',
    )
  })
})
