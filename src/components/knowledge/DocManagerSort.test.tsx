// @vitest-environment happy-dom
/**
 * 文档管理（主区浏览 + 侧边栏）层级排序与拖拽（X3）。
 * 主区浏览：展示顺序 = 树内 order（listChildren；X3 后拖拽排序直接可见）。
 * 侧边栏 DirNavList：文件夹优先，目录与文件各自按名称升序（v1.1 不做侧栏拖拽）。
 */
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { listChildren } from '@/domain/knowledge/tree'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { DocManagerBrowse } from './DocManagerBrowse'
import { DirNavList } from './DirNavList'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count != null ? `${key}:${opts.count}` : key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const knowledgeSaveTree = vi.fn()
const knowledgeReadDoc = vi.fn()
vi.mock('@/ipc/knowledge', () => ({
  knowledgeRevealDoc: vi.fn(),
  knowledgeSaveTree: (...a: unknown[]) => knowledgeSaveTree(...a),
  knowledgeReadDoc: (...a: unknown[]) => knowledgeReadDoc(...a),
  knowledgeErrorMessage: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
}))

vi.mock('@/components/context-menu', () => ({
  DeclarativeContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

function node(
  id: string,
  kind: KnowledgeNode['kind'],
  title: string,
  updatedAt: number,
  parentId: string | null = null,
  order = 0,
): KnowledgeNode {
  return { id, parentId, kind, title, order, createdAt: 1, updatedAt }
}

/**
 * order 故意与名称序相反：
 * order 序 → Zulu(500), Beta(400), AlphaDoc(100), Alpha(300)
 * 名称序 → Alpha, AlphaDoc, Beta, Zulu
 */
const MIXED_NODES = [
  node('doc_z', 'doc', 'Zulu', 500, null, 3),
  node('nod_b', 'folder', 'Beta', 400, null, 1),
  node('doc_a', 'doc', 'AlphaDoc', 100, null, 2),
  node('nod_a', 'folder', 'Alpha', 300, null, 0),
]

function dragPayload() {
  return {
    setData: vi.fn(),
    effectAllowed: 'none' as const,
    dropEffect: 'none' as const,
  } as unknown as DataTransfer
}

/**
 * happy-dom 的 DragEvent 不带 clientX/Y，改用 MouseEvent + 注入 dataTransfer。
 * 冒泡到 React 根部后走合成事件系统，行为与真实拖拽一致。
 */
function fireDrag(
  target: Element,
  type: 'dragstart' | 'dragover' | 'drop',
  clientY: number,
  transfer: DataTransfer = dragPayload(),
) {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 20,
    clientY,
  })
  Object.defineProperty(ev, 'dataTransfer', { value: transfer })
  // act：让 dragstart 的 setState 在下一个事件前 flush。
  act(() => {
    target.dispatchEvent(ev)
  })
}

function rectOf(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 100,
    width: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30))
  })
}

/** 展示序（listChildren = order 序）。 */
function displayOrder(): string[] {
  return listChildren(useKnowledgeStore.getState().nodes, null).map((n) => n.id)
}

describe('DocManagerBrowse 排序（X3 后 = order 序）', () => {
  beforeEach(() => {
    knowledgeSaveTree.mockResolvedValue(undefined)
    knowledgeReadDoc.mockResolvedValue('')
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [],
      activeSpaceId: 'sp_1',
      nodes: MIXED_NODES,
      currentFolderId: null,
      activeDocId: null,
      busy: false,
    })
  })

  afterEach(() => cleanup())

  it('列表视图按树内 order 展示（拖拽排序可见）', () => {
    render(<DocManagerBrowse />)
    const rows = screen
      .getAllByTestId(/^browse-row-(?!menu-)/)
      .map((el) => el.getAttribute('data-testid'))
    expect(rows).toEqual([
      'browse-row-nod_a',
      'browse-row-nod_b',
      'browse-row-doc_a',
      'browse-row-doc_z',
    ])
  })

  it('网格视图（切换后）同样按 order 展示', () => {
    render(<DocManagerBrowse />)
    fireEvent.click(screen.getByTestId('browse-view-grid'))
    const tiles = screen
      .getAllByTestId(/^browse-tile-/)
      .map((el) => el.getAttribute('data-testid'))
    expect(tiles).toEqual([
      'browse-tile-nod_a',
      'browse-tile-nod_b',
      'browse-tile-doc_a',
      'browse-tile-doc_z',
    ])
  })

  it('X3: 拖到文档行上半 = before，插入指示线出现，drop 后 order 持久化', async () => {
    render(<DocManagerBrowse />)
    const rowA = screen.getByTestId('browse-row-doc_a')
    const rowZ = screen.getByTestId('browse-row-doc_z')
    vi.spyOn(rowA, 'getBoundingClientRect').mockReturnValue(rectOf(0, 40))

    fireDrag(rowZ, 'dragstart', 0)
    fireDrag(rowA, 'dragover', 10)
    expect(screen.getByTestId('browse-drop-line-doc_a')).toBeInTheDocument()

    fireDrag(rowA, 'drop', 10)
    await settle()

    // doc_z 被插到 doc_a 之前（原序 nod_a, nod_b, doc_a, doc_z）
    expect(displayOrder()).toEqual(['nod_a', 'nod_b', 'doc_z', 'doc_a'])
    expect(knowledgeSaveTree).toHaveBeenCalledWith(
      'sp_1',
      expect.objectContaining({ version: 1 }),
    )
  })

  it('X3: 拖到文档行下半 = after', async () => {
    render(<DocManagerBrowse />)
    const rowZ = screen.getByTestId('browse-row-doc_z')
    const rowA = screen.getByTestId('browse-row-doc_a')
    vi.spyOn(rowZ, 'getBoundingClientRect').mockReturnValue(rectOf(0, 40))

    fireDrag(rowA, 'dragstart', 0)
    fireDrag(rowZ, 'dragover', 30)
    fireDrag(rowZ, 'drop', 30)
    await settle()

    // doc_a 插到 doc_z 之后 → nod_a, nod_b, doc_z, doc_a
    expect(displayOrder()).toEqual(['nod_a', 'nod_b', 'doc_z', 'doc_a'])
  })

  it('X3: 拖到文件夹行 = 移入末尾（parentId 持久化）', async () => {
    render(<DocManagerBrowse />)
    const rowA = screen.getByTestId('browse-row-doc_a')
    const folderB = screen.getByTestId('browse-row-nod_b')

    fireDrag(rowA, 'dragstart', 0)
    fireDrag(folderB, 'dragover', 5)
    fireDrag(folderB, 'drop', 5)
    await settle()

    const moved = useKnowledgeStore.getState().nodes.find((n) => n.id === 'doc_a')
    expect(moved?.parentId).toBe('nod_b')
    expect(moved?.order).toBe(0)
  })

  it('X3: 拖到面包屑 = 移入该祖先文件夹', async () => {
    const F = node('nod_f', 'folder', 'F', 1)
    const G = node('nod_g', 'folder', 'G', 2, 'nod_f')
    const docX = node('doc_x', 'doc', 'X', 3, 'nod_g')
    useKnowledgeStore.setState({
      nodes: [F, G, docX],
      currentFolderId: 'nod_g',
    })
    render(<DocManagerBrowse />)

    const crumbF = screen.getByTestId('browse-crumb-nod_f')
    const rowX = screen.getByTestId('browse-row-doc_x')
    fireDrag(rowX, 'dragstart', 0)
    fireDrag(crumbF, 'dragover', 5)
    fireDrag(crumbF, 'drop', 5)
    await settle()

    const moved = useKnowledgeStore.getState().nodes.find((n) => n.id === 'doc_x')
    expect(moved?.parentId).toBe('nod_f')
  })

  it('X3: 行内 data-no-drag 元素（重命名输入框）不发起拖拽', () => {
    render(<DocManagerBrowse />)
    const rowA = screen.getByTestId('browse-row-doc_a')
    const input = document.createElement('input')
    input.setAttribute('data-no-drag', '')
    rowA.appendChild(input)
    const dt = dragPayload()

    fireDrag(input, 'dragstart', 0, dt)
    expect(dt.setData).not.toHaveBeenCalled()
  })
})

describe('DocManagerBrowse 批量操作（X4）', () => {
  beforeEach(() => {
    knowledgeSaveTree.mockResolvedValue(undefined)
    knowledgeReadDoc.mockResolvedValue('')
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [],
      activeSpaceId: 'sp_1',
      nodes: MIXED_NODES,
      currentFolderId: null,
      activeDocId: null,
      busy: false,
    })
  })

  afterEach(() => cleanup())

  it('⌘+点击进入批量态：复选框 + 计数批量条出现', () => {
    render(<DocManagerBrowse />)
    expect(screen.queryByTestId('kb-browse-multiselect-bar')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('browse-row-doc_a'), { metaKey: true })
    expect(screen.getByTestId('kb-browse-multiselect-bar')).toBeInTheDocument()
    expect(
      screen.getByTestId('kb-browse-multiselect-count').textContent,
    ).toContain(':1')
    expect(screen.getByTestId('browse-check-doc_a')).toBeInTheDocument()
    expect(screen.getByTestId('browse-check-doc_z')).toBeInTheDocument()
    // 选中行暖灰 + 复选框勾选
    expect(screen.getByTestId('browse-row-doc_a').textContent).toContain('✓')
    // 文件夹行不参与选择
    expect(screen.queryByTestId('browse-check-nod_a')).not.toBeInTheDocument()
  })

  it('Shift 连选：从锚点扩展连续范围', () => {
    render(<DocManagerBrowse />)
    fireEvent.click(screen.getByTestId('browse-row-doc_a'), { metaKey: true })
    fireEvent.click(screen.getByTestId('browse-row-doc_z'), { shiftKey: true })
    expect(
      screen.getByTestId('kb-browse-multiselect-count').textContent,
    ).toContain(':2')
    expect(screen.getByTestId('browse-row-doc_a').textContent).toContain('✓')
    expect(screen.getByTestId('browse-row-doc_z').textContent).toContain('✓')
  })

  it('Esc 退出批量态，批量条消失', () => {
    render(<DocManagerBrowse />)
    fireEvent.click(screen.getByTestId('browse-row-doc_a'), { metaKey: true })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('kb-browse-multiselect-bar')).not.toBeInTheDocument()
  })

  it('点击内容空白退出批量态', () => {
    render(<DocManagerBrowse />)
    fireEvent.click(screen.getByTestId('browse-row-doc_a'), { metaKey: true })
    fireEvent.click(screen.getByTestId('browse-content'))
    expect(screen.queryByTestId('kb-browse-multiselect-bar')).not.toBeInTheDocument()
  })

  it('批量删除：确认弹层 → 调用 deleteNodes → 清空选区', async () => {
    const calls: string[][] = []
    useKnowledgeStore.setState({
      deleteNodes: async (ids: string[]) => {
        calls.push(ids)
      },
    })
    render(<DocManagerBrowse />)
    fireEvent.click(screen.getByTestId('browse-row-doc_a'), { metaKey: true })
    fireEvent.click(screen.getByTestId('browse-row-doc_z'), { metaKey: true })
    fireEvent.click(screen.getByTestId('kb-browse-multiselect-delete'))
    const confirm = screen.getByTestId('kb-browse-delete-confirm')
    await act(async () => {
      fireEvent.click(confirm)
    })
    expect(calls).toEqual([['doc_a', 'doc_z']])
    expect(
      screen.queryByTestId('kb-browse-multiselect-bar'),
    ).not.toBeInTheDocument()
  })
})

describe('DirNavList 排序', () => {
  beforeEach(() => {
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [],
      activeSpaceId: null,
      nodes: MIXED_NODES,
      currentFolderId: null,
      activeDocId: null,
      busy: false,
    })
  })

  afterEach(() => cleanup())

  it('文件夹在前，目录与文件各自按名称升序', () => {
    render(<DirNavList />)
    const rows = screen
      .getAllByTestId(/^dir-row-(?!add-)/)
      .map((el) => el.getAttribute('data-testid'))
    expect(rows).toEqual([
      'dir-row-nod_a',
      'dir-row-nod_b',
      'dir-row-doc_a',
      'dir-row-doc_z',
    ])
  })
})
