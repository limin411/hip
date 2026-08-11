import { describe, it, expect, vi } from 'vitest'
import { knowledgeTreeProvider } from './knowledgeTree'
import type { ContextMenuBuildContext } from '../types'

const ctx = {
  t: ((k: string) => k) as ContextMenuBuildContext['t'],
  isMac: true,
} as ContextMenuBuildContext

describe('knowledgeTreeProvider', () => {
  it('returns root create actions for doc, table and folder', () => {
    const onNewDoc = vi.fn()
    const onNewTable = vi.fn()
    const onNewFolder = vi.fn()
    const items = knowledgeTreeProvider(
      {
        kind: 'knowledgeTree',
        payload: { onNewDoc, onNewTable, onNewFolder },
      },
      ctx,
    )
    expect(items.map((i) => i.id)).toEqual([
      'knowledgeTree.newDoc',
      'knowledgeTree.newTable',
      'knowledgeTree.newFolder',
    ])
    items.find((i) => i.id === 'knowledgeTree.newDoc')!.run()
    items.find((i) => i.id === 'knowledgeTree.newTable')!.run()
    items.find((i) => i.id === 'knowledgeTree.newFolder')!.run()
    expect(onNewDoc).toHaveBeenCalled()
    expect(onNewTable).toHaveBeenCalled()
    expect(onNewFolder).toHaveBeenCalled()
  })
})
