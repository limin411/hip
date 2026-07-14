// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SpaceTree } from './SpaceTree'
import { useKnowledgeStore } from '@/store/knowledgeStore'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/components/context-menu', () => ({
  DeclarativeContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const noop = () => {}

function seedTree(activeDocId: string | null) {
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
    docBody: '',
    draftBody: '',
    editing: false,
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
