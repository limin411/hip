import { describe, it, expect, vi } from 'vitest'
import { knowledgeTreeProvider } from './knowledgeTree'
import type { ContextMenuBuildContext } from '../types'

const ctx = {
  t: ((k: string) => k) as ContextMenuBuildContext['t'],
  isMac: true,
} as ContextMenuBuildContext

describe('knowledgeTreeProvider', () => {
  it('returns root create actions', () => {
    const onNewDoc = vi.fn()
    const onNewFolder = vi.fn()
    const items = knowledgeTreeProvider(
      {
        kind: 'knowledgeTree',
        payload: { onNewDoc, onNewFolder },
      },
      ctx,
    )
    expect(items.map((i) => i.id)).toEqual([
      'knowledgeTree.newDoc',
      'knowledgeTree.newFolder',
    ])
    items.find((i) => i.id === 'knowledgeTree.newDoc')!.run()
    items.find((i) => i.id === 'knowledgeTree.newFolder')!.run()
    expect(onNewDoc).toHaveBeenCalled()
    expect(onNewFolder).toHaveBeenCalled()
  })
})
