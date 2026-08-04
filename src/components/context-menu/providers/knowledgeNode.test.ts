import { describe, it, expect, vi } from 'vitest'
import { knowledgeNodeProvider } from './knowledgeNode'
import type { ContextMenuBuildContext } from '../types'

const ctx = {
  t: ((k: string) => k) as ContextMenuBuildContext['t'],
  isMac: true,
} as ContextMenuBuildContext

describe('knowledgeNodeProvider', () => {
  it('returns folder actions including new doc/folder', () => {
    const onNewDoc = vi.fn()
    const onNewFolder = vi.fn()
    const onRename = vi.fn()
    const onDelete = vi.fn()
    const items = knowledgeNodeProvider(
      {
        kind: 'knowledgeNode',
        payload: {
          nodeId: 'nod_a',
          kind: 'folder',
          spaceId: 'spc_a',
          onNewDoc,
          onNewFolder,
          onRename,
          onDelete,
        },
      },
      ctx,
    )
    expect(items.map((i) => i.id)).toEqual([
      'knowledgeNode.newDoc',
      'knowledgeNode.newFolder',
      'knowledgeNode.rename',
      'knowledgeNode.delete',
    ])
    items.find((i) => i.id === 'knowledgeNode.newDoc')!.run()
    expect(onNewDoc).toHaveBeenCalled()
  })

  it('includes reveal for docs when provided', () => {
    const onReveal = vi.fn()
    const items = knowledgeNodeProvider(
      {
        kind: 'knowledgeNode',
        payload: {
          nodeId: 'doc_a',
          kind: 'doc',
          spaceId: 'spc_a',
          onNewDoc: () => {},
          onNewFolder: () => {},
          onRename: () => {},
          onDelete: () => {},
          onReveal,
        },
      },
      ctx,
    )
    expect(items.map((i) => i.id)).toContain('knowledgeNode.reveal')
    items.find((i) => i.id === 'knowledgeNode.reveal')!.run()
    expect(onReveal).toHaveBeenCalled()
  })

  it('does not include reveal for boards', () => {
    const items = knowledgeNodeProvider(
      {
        kind: 'knowledgeNode',
        payload: {
          nodeId: 'brd_a',
          kind: 'board',
          spaceId: 'spc_a',
          onNewDoc: () => {},
          onNewFolder: () => {},
          onRename: () => {},
          onDelete: () => {},
          onReveal: () => {},
        },
      },
      ctx,
    )
    expect(items.map((i) => i.id)).not.toContain('knowledgeNode.reveal')
  })
})
