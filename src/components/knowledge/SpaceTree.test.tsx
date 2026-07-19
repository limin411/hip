// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { listVisibleTreeNodes, siblingInsertIndex, SpaceTree, TREE_ACTIVE_DOC } from './SpaceTree'
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
    editorMode: 'live',
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

  it('marks the active doc row with soft accent wash and left rail', () => {
    // Canonical string locks KD3 fragments (wash + rail; not SIDEBAR_ACTIVE_RAIL / accent-active).
    expect(TREE_ACTIVE_DOC).toContain('bg-accent/10')
    expect(TREE_ACTIVE_DOC).toContain('before:bg-accent')
    expect(TREE_ACTIVE_DOC).toContain('before:w-0.5')
    expect(TREE_ACTIVE_DOC).toContain('font-medium')
    expect(TREE_ACTIVE_DOC).not.toContain('bg-accent-active')
    expect(TREE_ACTIVE_DOC).not.toContain('SIDEBAR_ACTIVE_RAIL')

    render(
      <SpaceTree
        onRename={noop}
        onDelete={noop}
        onNewDoc={noop}
        onNewFolder={noop}
      />,
    )

    const active = screen.getByTestId('knowledge-tree-doc-doc_1')
    for (const token of TREE_ACTIVE_DOC.split(/\s+/).filter(Boolean)) {
      expect(active.className).toContain(token)
    }
    expect(active.className).not.toContain('shadow-[inset')
    expect(active.className).not.toContain('bg-accent-active')

    const inactive = screen.getByTestId('knowledge-tree-doc-doc_2')
    expect(inactive.className).not.toContain('bg-accent/10')
    expect(inactive.className).toContain('hover:bg-state-hover')
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
    expect(row.className).not.toContain('bg-accent/10')
    expect(row.className).not.toMatch(/inset/)
    expect(row.className).toContain('hover:bg-state-hover')
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

describe('siblingInsertIndex', () => {
  const siblings: KnowledgeNode[] = [
    {
      id: 'a',
      parentId: null,
      kind: 'doc',
      title: 'A',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'b',
      parentId: null,
      kind: 'doc',
      title: 'B',
      order: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'c',
      parentId: null,
      kind: 'doc',
      title: 'C',
      order: 2,
      createdAt: 1,
      updatedAt: 1,
    },
  ]

  it('computes index after removing the dragged sibling', () => {
    // Drag A before B → still index 0 among remaining [B,C] then insert before B
    expect(siblingInsertIndex(siblings, 'a', 'b', 'before')).toBe(0)
    // Drag A after B → among [B,C], after B → 1
    expect(siblingInsertIndex(siblings, 'a', 'b', 'after')).toBe(1)
    // Drag C before A → among [A,B], before A → 0
    expect(siblingInsertIndex(siblings, 'c', 'a', 'before')).toBe(0)
    // Drag C after A → 1
    expect(siblingInsertIndex(siblings, 'c', 'a', 'after')).toBe(1)
  })
})

describe('SpaceTree drag and drop (pointer)', () => {
  const moveNode = vi.fn(async () => {})

  beforeEach(() => {
    moveNode.mockClear()
    seedTree(null, {
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
          title: 'Note A',
          order: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'doc_2',
          parentId: null,
          kind: 'doc',
          title: 'Note B',
          order: 2,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      treeFocusId: null,
      activeDocId: null,
      moveNode,
    })
  })

  afterEach(() => {
    cleanup()
  })

  /** Simulate pointer drag from grip handle onto target row. */
  function pointerDndFromGrip(
    dragNodeId: string,
    target: HTMLElement,
    clientYRatio = 0.5,
  ) {
    const grip = screen.getByTestId(`knowledge-tree-drag-${dragNodeId}`)
    const srcRect = {
      top: 100,
      left: 10,
      width: 16,
      height: 24,
      bottom: 124,
      right: 26,
      x: 10,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect
    const tgtRect = {
      top: 200,
      left: 10,
      width: 200,
      height: 40,
      bottom: 240,
      right: 210,
      x: 10,
      y: 200,
      toJSON: () => ({}),
    } as DOMRect
    vi.spyOn(grip, 'getBoundingClientRect').mockReturnValue(srcRect)
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(tgtRect)

    const dropY = tgtRect.top + tgtRect.height * clientYRatio
    const dropX = tgtRect.left + tgtRect.width / 2

    fireEvent.pointerDown(grip, {
      button: 0,
      pointerId: 1,
      clientX: srcRect.left + 4,
      clientY: srcRect.top + 10,
    })
    // Past DRAG_THRESHOLD_PX (5)
    fireEvent.pointerMove(document, {
      pointerId: 1,
      clientX: srcRect.left + 4,
      clientY: srcRect.top + 20,
    })
    const prev = document.elementFromPoint.bind(document)
    vi.spyOn(document, 'elementFromPoint').mockImplementation((x, y) => {
      if (Math.abs(x - dropX) < 5 || Math.abs(y - dropY) < 30) return target
      return prev(x, y)
    })
    fireEvent.pointerMove(document, {
      pointerId: 1,
      clientX: dropX,
      clientY: dropY,
    })
    fireEvent.pointerUp(document, {
      pointerId: 1,
      clientX: dropX,
      clientY: dropY,
    })
  }

  it('reparents a doc into a folder when dragging from grip', () => {
    render(
      <SpaceTree
        onRename={noop}
        onDelete={noop}
        onNewDoc={noop}
        onNewFolder={noop}
      />,
    )
    const folder = screen.getByTestId('knowledge-tree-folder-fld_1')
    pointerDndFromGrip('doc_1', folder, 0.5)
    expect(moveNode).toHaveBeenCalledWith('doc_1', 'fld_1', 0)
  })

  it('reorders a doc after another root doc when dragging from grip', () => {
    render(
      <SpaceTree
        onRename={noop}
        onDelete={noop}
        onNewDoc={noop}
        onNewFolder={noop}
      />,
    )
    const doc2 = screen.getByTestId('knowledge-tree-doc-doc_2')
    // bottom half of doc2 → after
    pointerDndFromGrip('doc_1', doc2, 0.8)
    // siblings without drag: [fld_1, doc_2]; after doc_2 → index 2
    expect(moveNode).toHaveBeenCalledWith('doc_1', null, 2)
  })

  it('does not start drag from the title hit target', () => {
    render(
      <SpaceTree
        onRename={noop}
        onDelete={noop}
        onNewDoc={noop}
        onNewFolder={noop}
      />,
    )
    const doc = screen.getByTestId('knowledge-tree-doc-doc_1')
    const title = doc.querySelector('[role="presentation"]') as HTMLElement
    fireEvent.pointerDown(title, {
      button: 0,
      pointerId: 1,
      clientX: 40,
      clientY: 20,
    })
    fireEvent.pointerMove(document, {
      pointerId: 1,
      clientX: 40,
      clientY: 40,
    })
    fireEvent.pointerUp(document, {
      pointerId: 1,
      clientX: 40,
      clientY: 40,
    })
    expect(moveNode).not.toHaveBeenCalled()
    expect(doc.className).not.toContain('opacity-45')
  })

  it('exposes a dedicated drag handle on each row', () => {
    render(
      <SpaceTree
        onRename={noop}
        onDelete={noop}
        onNewDoc={noop}
        onNewFolder={noop}
      />,
    )
    const grip = screen.getByTestId('knowledge-tree-drag-doc_1')
    expect(grip.tagName).toBe('BUTTON')
    expect(grip).toHaveAttribute('aria-label', 'knowledge.tree.dragHandle')
  })
})
