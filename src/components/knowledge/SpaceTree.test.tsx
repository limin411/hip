// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { listVisibleTreeNodes, SpaceTree } from './SpaceTree'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import type { KnowledgeNode } from '@/domain/knowledge/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/components/context-menu', () => ({
  DeclarativeContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const noop = () => {}

function seedTree(activeDocId: string | null, extra?: Partial<ReturnType<typeof useKnowledgeStore.getState>>) {
  useKnowledgeStore.setState({
    loaded: true,
    spaces: [{ id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 }],
    activeSpaceId: 'spc_1',
    nodes: [
      {
        id: 'doc_1',
        parentId: null,
        kind: 'doc',
        title: 'Active Note',
        order: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'doc_2',
        parentId: null,
        kind: 'doc',
        title: 'Other Note',
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    activeDocId,
    treeFocusId: activeDocId,
    docBody: '',
    draftBody: '',
    editorMode: 'preview',
    mode: 'workspace',
    searchQuery: '',
    searchHits: [],
    indexStatus: 'idle',
    spaceDocCounts: { spc_1: 2 },
    recent: [],
    expandedFolderIds: {},
    busy: false,
    error: null,
    saveState: 'idle',
    ...extra,
  })
}

describe('SpaceTree selection visuals', () => {
  beforeEach(() => {
    seedTree('doc_1')
  })

  afterEach(() => {
    cleanup()
  })

  it('marks the active doc row with FileTree selection classes and no inset bar', () => {
    render(
      <SpaceTree
        onRename={noop}
        onDelete={noop}
        onNewDoc={noop}
        onNewFolder={noop}
      />,
    )

    const active = screen.getByTestId('knowledge-tree-doc-doc_1')
    expect(active.className).toContain('bg-accent-active')
    expect(active.className).toContain('text-accent-strong')
    expect(active.className).toContain('font-medium')
    expect(active.className).not.toMatch(/inset/)
    expect(active.className).not.toContain('shadow-[inset')

    const inactive = screen.getByTestId('knowledge-tree-doc-doc_2')
    expect(inactive.className).not.toContain('bg-accent-active')
    expect(inactive.className).toContain('hover:bg-surface-muted')
  })

  it('does not apply selection classes when no doc is active', () => {
    seedTree(null)
    render(
      <SpaceTree
        onRename={noop}
        onDelete={noop}
        onNewDoc={noop}
        onNewFolder={noop}
      />,
    )

    const row = screen.getByTestId('knowledge-tree-doc-doc_1')
    expect(row.className).not.toContain('bg-accent-active')
    expect(row.className).not.toMatch(/inset/)
    expect(row.className).toContain('hover:bg-surface-muted')
  })
})

describe('listVisibleTreeNodes', () => {
  const nodes: KnowledgeNode[] = [
    {
      id: 'fld_1',
      parentId: null,
      kind: 'folder',
      title: 'F',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'doc_a',
      parentId: 'fld_1',
      kind: 'doc',
      title: 'A',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'doc_b',
      parentId: null,
      kind: 'doc',
      title: 'B',
      order: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  ]

  it('hides children of collapsed folders', () => {
    expect(listVisibleTreeNodes(nodes, {}).map((n) => n.id)).toEqual(['fld_1', 'doc_b'])
  })

  it('includes children when folder expanded', () => {
    expect(listVisibleTreeNodes(nodes, { fld_1: true }).map((n) => n.id)).toEqual([
      'fld_1',
      'doc_a',
      'doc_b',
    ])
  })
})

describe('SpaceTree keyboard navigation', () => {
  beforeEach(() => {
    seedTree('doc_1', {
      nodes: [
        {
          id: 'fld_1',
          parentId: null,
          kind: 'folder',
          title: 'Folder',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'doc_1',
          parentId: null,
          kind: 'doc',
          title: 'Note',
          order: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'doc_inner',
          parentId: 'fld_1',
          kind: 'doc',
          title: 'Inner',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      expandedFolderIds: {},
      treeFocusId: 'fld_1',
      activeDocId: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('ArrowDown / ArrowUp move treeFocusId', () => {
    render(
      <SpaceTree
        onRename={noop}
        onDelete={noop}
        onNewDoc={noop}
        onNewFolder={noop}
      />,
    )
    const tree = screen.getByTestId('knowledge-tree')
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(useKnowledgeStore.getState().treeFocusId).toBe('doc_1')
    fireEvent.keyDown(tree, { key: 'ArrowUp' })
    expect(useKnowledgeStore.getState().treeFocusId).toBe('fld_1')
  })

  it('ArrowRight expands folder; ArrowLeft collapses', () => {
    render(
      <SpaceTree
        onRename={noop}
        onDelete={noop}
        onNewDoc={noop}
        onNewFolder={noop}
      />,
    )
    const tree = screen.getByTestId('knowledge-tree')
    fireEvent.keyDown(tree, { key: 'ArrowRight' })
    expect(useKnowledgeStore.getState().expandedFolderIds.fld_1).toBe(true)
    fireEvent.keyDown(tree, { key: 'ArrowLeft' })
    expect(useKnowledgeStore.getState().expandedFolderIds.fld_1).toBe(false)
  })

  it('Enter toggles focused folder', () => {
    render(
      <SpaceTree
        onRename={noop}
        onDelete={noop}
        onNewDoc={noop}
        onNewFolder={noop}
      />,
    )
    const tree = screen.getByTestId('knowledge-tree')
    fireEvent.keyDown(tree, { key: 'Enter' })
    expect(useKnowledgeStore.getState().expandedFolderIds.fld_1).toBe(true)
  })

  it('ArrowRight on expanded folder moves focus to first child', () => {
    useKnowledgeStore.setState({ expandedFolderIds: { fld_1: true }, treeFocusId: 'fld_1' })
    render(
      <SpaceTree
        onRename={noop}
        onDelete={noop}
        onNewDoc={noop}
        onNewFolder={noop}
      />,
    )
    const tree = screen.getByTestId('knowledge-tree')
    fireEvent.keyDown(tree, { key: 'ArrowRight' })
    expect(useKnowledgeStore.getState().treeFocusId).toBe('doc_inner')
  })

  it('falls back tabIndex to first root when treeFocusId is not visible', () => {
    // Focus a nested doc while parent is collapsed → row not mounted
    useKnowledgeStore.setState({
      treeFocusId: 'doc_inner',
      expandedFolderIds: {},
      activeDocId: null,
    })
    render(
      <SpaceTree
        onRename={noop}
        onDelete={noop}
        onNewDoc={noop}
        onNewFolder={noop}
      />,
    )
    expect(screen.queryByTestId('knowledge-tree-doc-doc_inner')).toBeNull()
    const firstRoot = screen.getByTestId('knowledge-tree-folder-fld_1')
    expect(firstRoot.tabIndex).toBe(0)
  })

  it('aria-selected only for active doc, not mere keyboard focus', () => {
    useKnowledgeStore.setState({
      treeFocusId: 'fld_1',
      activeDocId: 'doc_1',
    })
    render(
      <SpaceTree
        onRename={noop}
        onDelete={noop}
        onNewDoc={noop}
        onNewFolder={noop}
      />,
    )
    expect(screen.getByTestId('knowledge-tree-folder-fld_1').getAttribute('aria-selected')).toBe(
      'false',
    )
    expect(screen.getByTestId('knowledge-tree-doc-doc_1').getAttribute('aria-selected')).toBe(
      'true',
    )
  })

  it('keyboard uses visible rows when treeFocusId is filtered out', () => {
    useKnowledgeStore.setState({
      expandedFolderIds: { fld_1: true },
      treeFocusId: 'doc_1', // not in filter set
      activeDocId: null,
    })
    const visibleIds = new Set(['fld_1', 'doc_inner'])
    render(
      <SpaceTree
        onRename={noop}
        onDelete={noop}
        onNewDoc={noop}
        onNewFolder={noop}
        visibleIds={visibleIds}
      />,
    )
    const tree = screen.getByTestId('knowledge-tree')
    // Enter should act on first visible (fld_1), not the filtered-out focus
    fireEvent.keyDown(tree, { key: 'Enter' })
    expect(useKnowledgeStore.getState().expandedFolderIds.fld_1).toBe(false)
    expect(useKnowledgeStore.getState().treeFocusId).toBe('fld_1')
  })
})
