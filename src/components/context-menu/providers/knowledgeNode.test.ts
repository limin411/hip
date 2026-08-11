import { describe, it, expect, vi } from 'vitest'
import { knowledgeNodeProvider } from './knowledgeNode'
import type { ContextMenuBuildContext } from '../types'

const ctx = {
  t: ((k: string) => k) as ContextMenuBuildContext['t'],
  isMac: true,
} as ContextMenuBuildContext

describe('knowledgeNodeProvider', () => {
  it('returns folder actions including new doc/table/folder', () => {
    const onNewDoc = vi.fn()
    const onNewTable = vi.fn()
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
          onNewTable,
          onNewFolder,
          onRename,
          onDelete,
        },
      },
      ctx,
    )
    expect(items.map((i) => i.id)).toEqual([
      'knowledgeNode.newDoc',
      'knowledgeNode.newTable',
      'knowledgeNode.newFolder',
      'knowledgeNode.rename',
      'knowledgeNode.delete',
    ])
    items.find((i) => i.id === 'knowledgeNode.newDoc')!.run()
    items.find((i) => i.id === 'knowledgeNode.newTable')!.run()
    expect(onNewDoc).toHaveBeenCalled()
    expect(onNewTable).toHaveBeenCalled()
  })

  it('files (doc) get no new doc/table/folder entries — file actions only', () => {
    const onNewDoc = vi.fn()
    const onNewTable = vi.fn()
    const onNewFolder = vi.fn()
    const items = knowledgeNodeProvider(
      {
        kind: 'knowledgeNode',
        payload: {
          nodeId: 'doc_a',
          kind: 'doc',
          spaceId: 'spc_a',
          onNewDoc,
          onNewTable,
          onNewFolder,
          onRename: () => {},
          onDelete: () => {},
        },
      },
      ctx,
    )
    const ids = items.map((i) => i.id)
    expect(ids).not.toContain('knowledgeNode.newDoc')
    expect(ids).not.toContain('knowledgeNode.newTable')
    expect(ids).not.toContain('knowledgeNode.newFolder')
    expect(ids).toContain('knowledgeNode.rename')
    expect(ids).toContain('knowledgeNode.delete')
    expect(onNewDoc).not.toHaveBeenCalled()
    expect(onNewTable).not.toHaveBeenCalled()
    expect(onNewFolder).not.toHaveBeenCalled()
  })

  it('tables get no new doc/table/folder entries either', () => {
    const items = knowledgeNodeProvider(
      {
        kind: 'knowledgeNode',
        payload: {
          nodeId: 'tbl_a',
          kind: 'table',
          spaceId: 'spc_a',
          onNewDoc: () => {},
          onNewTable: () => {},
          onNewFolder: () => {},
          onRename: () => {},
          onDelete: () => {},
        },
      },
      ctx,
    )
    const ids = items.map((i) => i.id)
    expect(ids).not.toContain('knowledgeNode.newDoc')
    expect(ids).not.toContain('knowledgeNode.newTable')
    expect(ids).not.toContain('knowledgeNode.newFolder')
    expect(ids).toEqual(['knowledgeNode.rename', 'knowledgeNode.delete'])
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
          onNewTable: () => {},
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
          onNewTable: () => {},
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
