// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, vi, afterEach, beforeEach, expect } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { DocManagerBrowse } from '@/components/knowledge/DocManagerBrowse'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import type { KnowledgeNode } from '@/domain/knowledge/types'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return { ...actual, useTranslation: () => ({ t: (k: string) => k }) }
})
vi.mock('@/ipc/knowledge', () => ({
  knowledgeRevealDoc: vi.fn(),
  knowledgeErrorMessage: (e: unknown) => String(e),
}))
vi.mock('@/ipc/dialog', () => ({ pickSavePath: vi.fn(), pickAttachmentFiles: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() },
}))

afterEach(() => cleanup())

const mkNode = (n: Partial<KnowledgeNode>): KnowledgeNode => ({
  id: 'n_1',
  parentId: null,
  kind: 'folder',
  title: '根',
  order: 0,
  createdAt: 1,
  updatedAt: 1,
  ...n,
})

describe('DocManagerBrowse inline-new', () => {
  beforeEach(() => {
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [{ id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 }],
      activeSpaceId: 'spc_1',
      nodes: [mkNode({ id: 'n_1' })],
      currentFolderId: null,
      activeDocId: null,
      mode: 'workspace',
      docBody: '',
      draftBody: '',
      editorMode: 'live',
      searchQuery: '',
      searchHits: [],
      indexStatus: 'idle',
      spaceDocCounts: {},
      recent: [],
      expandedFolderIds: {},
      tableDoc: null,
      tableDraft: null,
      tableSaveState: 'idle',
      busy: false,
      error: null,
      saveState: 'idle',
      templatePicker: null,
      createFolder: vi.fn(async () => undefined) as never,
      requestCreateTable: vi.fn(async () => undefined) as never,
      requestCreateDoc: vi.fn(async () => undefined) as never,
    })
  })

  it('blur commits new folder with typed name (no Enter needed)', () => {
    const createFolder = useKnowledgeStore.getState().createFolder as ReturnType<typeof vi.fn>
    render(<DocManagerBrowse />)
    // 打开新建下拉 → 新建文件夹
    fireEvent.click(screen.getByTestId('browse-new'))
    fireEvent.click(screen.getByTestId('browse-new-menu').querySelector('button:nth-child(1)')!)
    const input = screen.getByTestId('browse-inline-new').querySelector('input')!
    fireEvent.change(input, { target: { value: '预算' } })
    fireEvent.blur(input)
    expect(createFolder).toHaveBeenCalledWith(null, '预算')
  })

  it('blur with empty title falls back to default folder name', () => {
    const createFolder = useKnowledgeStore.getState().createFolder as ReturnType<typeof vi.fn>
    render(<DocManagerBrowse />)
    fireEvent.click(screen.getByTestId('browse-new'))
    fireEvent.click(screen.getByTestId('browse-new-menu').querySelector('button:nth-child(1)')!)
    const input = screen.getByTestId('browse-inline-new').querySelector('input')!
    fireEvent.blur(input)
    expect(createFolder).toHaveBeenCalledWith(null, 'knowledge.tree.newFolder')
  })

  it('Escape cancels inline new (no folder created, no blur commit)', () => {
    const createFolder = useKnowledgeStore.getState().createFolder as ReturnType<typeof vi.fn>
    render(<DocManagerBrowse />)
    fireEvent.click(screen.getByTestId('browse-new'))
    fireEvent.click(screen.getByTestId('browse-new-menu').querySelector('button:nth-child(1)')!)
    const input = screen.getByTestId('browse-inline-new').querySelector('input')!
    fireEvent.change(input, { target: { value: '别建' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    // 卸载后可能伴随 blur：断言未被创建
    fireEvent.blur(input)
    expect(createFolder).not.toHaveBeenCalled()
    expect(screen.queryByTestId('browse-inline-new')).toBeNull()
  })

  it('blur commits new table via requestCreateTable', () => {
    const requestCreateTable = useKnowledgeStore.getState()
      .requestCreateTable as ReturnType<typeof vi.fn>
    render(<DocManagerBrowse />)
    fireEvent.click(screen.getByTestId('browse-new'))
    fireEvent.click(screen.getByTestId('browse-new-menu').querySelector('button:nth-child(3)')!)
    const input = screen.getByTestId('browse-inline-new').querySelector('input')!
    fireEvent.change(input, { target: { value: '排期' } })
    fireEvent.blur(input)
    expect(requestCreateTable).toHaveBeenCalledWith(null, '排期')
  })
})
