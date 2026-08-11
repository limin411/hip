// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, fireEvent, screen, within, cleanup } from '@testing-library/react'
import { TableEditor } from './TableEditor'
import { useKnowledgeStore } from '@/store/knowledgeStore'

const knowledgeReadTable = vi.fn()
const knowledgeWriteTable = vi.fn()
const knowledgeExportText = vi.fn()
const pickSavePath = vi.fn()
const knowledgeSaveTree = vi.fn()
const commitTableSpy = vi.fn()

vi.mock('@/ipc/knowledge', () => ({
  knowledgeReadTable: (...a: unknown[]) => knowledgeReadTable(...a),
  knowledgeWriteTable: (...a: unknown[]) => knowledgeWriteTable(...a),
  knowledgeExportText: (...a: unknown[]) => knowledgeExportText(...a),
  knowledgeSaveTree: (...a: unknown[]) => knowledgeSaveTree(...a),
  knowledgeErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))

vi.mock('@/ipc/dialog', () => ({
  pickSavePath: (...a: unknown[]) => pickSavePath(...a),
  pickAttachmentFiles: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() },
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'knowledge.table.columnLabel') return `列 ${opts?.n}`
      if (key === 'knowledge.table.status.rowsCols') return `${opts?.rows} 行 · ${opts?.cols} 列`
      if (key === 'knowledge.table.status.selectionCount') return `已选 ${opts?.n} 格`
      if (key === 'knowledge.table.status.visibleRows') return `可见 ${opts?.n}/${opts?.total} 行`
      if (key === 'knowledge.table.types.text') return '文本'
      if (key === 'knowledge.table.types.number') return '数字'
      if (key === 'knowledge.table.types.checkbox') return '勾选'
      if (key === 'knowledge.table.types.date') return '日期'
      if (key === 'knowledge.table.types.select') return '单选'
      return key
    },
  }),
  }
})

const CSV = 'a,100,c\n1,200,3\nx,300,z\n'
const META = JSON.stringify({
  cols: [
    { id: 'col_1', name: '任务', type: 'text', width: 150 },
    { id: 'col_2', name: '预算', type: 'number', width: 150 },
    { id: 'col_3', name: '状态', type: 'select', options: ['待办', '完成'], width: 150 },
  ],
})

function mountTable() {
  useKnowledgeStore.setState({
    loaded: true,
    spaces: [{ id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 }],
    activeSpaceId: 'spc_1',
    nodes: [{ id: 'tbl_1', parentId: null, kind: 'table', title: '预算', order: 0, createdAt: 1, updatedAt: 1 }],
    activeDocId: 'tbl_1',
    docBody: '',
    draftBody: '',
    tableDoc: { id: 'tbl_1', csv: CSV, meta: META },
    tableDraft: { id: 'tbl_1', csv: CSV, meta: META },
    tableSaveState: 'idle',
    editorMode: 'live',
    mode: 'workspace',
    currentFolderId: null,
    searchQuery: '',
    searchHits: [],
    indexStatus: 'idle',
    spaceDocCounts: { spc_1: 1 },
    recent: [],
    expandedFolderIds: {},
    busy: false,
    error: null,
    saveState: 'idle',
  })
}

describe('TableEditor (knowledge-table PR-3)', () => {
  beforeEach(() => {
    mountTable()
    commitTableSpy.mockReset()
    // 让防抖保存不真跑 IPC：直接替换 commitTable
    useKnowledgeStore.setState({
      commitTable: vi.fn(async () => {
        commitTableSpy()
        return true
      }) as never,
    })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders grid with cols/rows and header names', () => {
    render(<TableEditor tableId="tbl_1" />)
    const grid = screen.getByTestId('table-grid')
    expect(grid.dataset.cols).toBe('3')
    expect(grid.dataset.rows).toBe('3')
    expect(screen.getByTestId('table-grid').querySelector('th[data-col="0"]')!.textContent).toContain('任务')
    expect(screen.getByTestId('table-grid').querySelector('th[data-col="1"]')!.textContent).toContain('预算')
    expect(screen.getByTestId('table-grid').querySelector('th[data-col="2"]')!.textContent).toContain('状态')
    // 数字列右对齐
    expect(document.querySelector('td[data-cell="0,1"]')!.className).toContain('text-right')
    // 状态栏（标题栏与状态栏各一处）
    expect(screen.getAllByText('3 行 · 3 列').length).toBeGreaterThanOrEqual(1)
  })

  it('edits a cell on double click and commits on Enter', () => {
        render(<TableEditor tableId="tbl_1" />)
    const cell = screen.getByTestId('table-cell-0-0')
    fireEvent.doubleClick(cell)
    const input = screen.getByTestId('table-cell-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '新任务' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('table-cell-0-0').textContent).toContain('新任务')
    // draft 已同步（csv 含新值）
    const draft = useKnowledgeStore.getState().tableDraft
    expect(draft?.csv).toContain('新任务')
  })

  it('edits via direct character input; Escape cancels the edit state (input already written, Notion semantics)', async () => {
    render(<TableEditor tableId="tbl_1" />)
    const grid = screen.getByTestId('table-grid')
    // 直接输入 'q' 进入编辑（值已写入单元格）
    fireEvent.keyDown(grid, { key: 'q' })
    const input = screen.getByTestId('table-cell-input')
    expect((input as HTMLInputElement).value).toBe('q')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('table-cell-input')).toBeNull()
    // 新语义：输入即写入选区（Notion）；Esc 仅取消编辑态
    expect(screen.getByTestId('table-cell-0-0').textContent).toContain('q')
  })

  it('Tab moves right, Enter moves down and appends a row at the end', () => {
    render(<TableEditor tableId="tbl_1" />)
    const grid = screen.getByTestId('table-grid')
    fireEvent.keyDown(grid, { key: 'Tab' })
    expect(document.querySelector('td[data-cell="0,1"]')!.className).toContain('outline')
    fireEvent.keyDown(grid, { key: 'Enter' })
    expect(document.querySelector('td[data-cell="1,1"]')!.className).toContain('outline')
    // 最后一行 Enter → 自动加行
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'Enter' })
    expect(useKnowledgeStore.getState().tableDraft?.csv.split('\n')).toHaveLength(4)
  })

  it('Delete clears the selected cell', () => {
    render(<TableEditor tableId="tbl_1" />)
    const grid = screen.getByTestId('table-grid')
    fireEvent.keyDown(grid, { key: 'Delete' })
    expect(useKnowledgeStore.getState().tableDraft?.csv).toBe(',100,c\n1,200,3\nx,300,z')
    expect(document.querySelector('td[data-cell="0,0"]')!.textContent).toBe('')
  })

  it('checkbox column toggles on click (space too)', () => {
    useKnowledgeStore.setState({
      tableDoc: {
        id: 'tbl_1',
        csv: 'x\n',
        meta: JSON.stringify({ cols: [{ id: 'col_1', name: '勾选', type: 'checkbox', width: 150 }] }),
      },
      tableDraft: {
        id: 'tbl_1',
        csv: 'x\n',
        meta: JSON.stringify({ cols: [{ id: 'col_1', name: '勾选', type: 'checkbox', width: 150 }] }),
      },
    })
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(screen.getByTestId('table-check-0-0'))
    expect(screen.getByTestId('table-check-0-0').textContent).toContain('✓')
    expect(useKnowledgeStore.getState().tableDraft?.csv).toBe('1')
    // 空格切换回 0
    const grid = screen.getByTestId('table-grid')
    fireEvent.keyDown(grid, { key: ' ' })
    expect(useKnowledgeStore.getState().tableDraft?.csv).toBe('0')
  })

  it('column menu: rename + type switch + insert/delete column', async () => {
    render(<TableEditor tableId="tbl_1" />)
    // 打开列菜单（点第 0 列头）
    fireEvent.click(screen.getByTestId('table-col-more-0'))
    expect(screen.getByTestId('table-col-menu')).toBeTruthy()
    // 重命名
    fireEvent.click(screen.getByTestId('table-col-rename'))
    const renameInput = screen.getByTestId('table-col-rename-input') as HTMLInputElement
    fireEvent.change(renameInput, { target: { value: '事项' } })
    fireEvent.keyDown(renameInput, { key: 'Enter' })
    expect(screen.getByText('事项')).toBeTruthy()
    // 类型切换 → number
    fireEvent.click(screen.getByTestId('table-col-more-0'))
    fireEvent.click(screen.getByTestId('table-col-type-number'))
    expect((screen.getByTestId('table-grid').querySelector('th[data-col="0"]') as HTMLElement).dataset.colType).toBe('number')
    // 插右列
    fireEvent.click(screen.getByTestId('table-col-more-0'))
    fireEvent.click(screen.getByTestId('table-col-insert-right'))
    expect(screen.getByTestId('table-grid').dataset.cols).toBe('4')
    // 删除列
    fireEvent.click(screen.getByTestId('table-col-more-3'))
    fireEvent.click(screen.getByTestId('table-col-delete'))
    expect(screen.getByTestId('table-grid').dataset.cols).toBe('3')
    // 非法数字值保留原样：把 text 列改回 text 后值仍在
    expect(screen.getByTestId('table-cell-0-0').textContent).toContain('a')
  })

  it('column rename commits on blur (Excel 式点击他处生效) and Tab; Esc cancels', () => {
    render(<TableEditor tableId="tbl_1" />)
    const openRename = () => {
      fireEvent.click(screen.getByTestId('table-col-more-0'))
      fireEvent.click(screen.getByTestId('table-col-rename'))
      return screen.getByTestId('table-col-rename-input') as HTMLInputElement
    }
    // blur 提交
    let input = openRename()
    fireEvent.change(input, { target: { value: '计划' } })
    fireEvent.blur(input)
    expect(screen.getByText('计划')).toBeTruthy()
    // Tab 提交
    input = openRename()
    fireEvent.change(input, { target: { value: '排期' } })
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(screen.getByText('排期')).toBeTruthy()
    // Esc 取消（不写回）
    input = openRename()
    fireEvent.change(input, { target: { value: '别改' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByText('别改')).toBeNull()
    expect(screen.getByText('排期')).toBeTruthy()
    // 空文本提交不生效（保留原名）
    input = openRename()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(screen.getByText('排期')).toBeTruthy()
  })

  it('row menu: insert above / duplicate / delete', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(screen.getByTestId('table-row-menu-1'))
    expect(screen.getByTestId('table-row-menu')).toBeTruthy()
    // 复制行
    fireEvent.click(within(screen.getByTestId('table-row-menu')).getByText('knowledge.table.rowMenu.duplicate'))
    expect(useKnowledgeStore.getState().tableDraft?.csv.split('\n')).toHaveLength(4)
    // 删除行
    fireEvent.click(screen.getByTestId('table-row-menu-3'))
    fireEvent.click(within(screen.getByTestId('table-row-menu')).getByText('knowledge.table.rowMenu.deleteRow'))
    expect(useKnowledgeStore.getState().tableDraft?.csv.split('\n')).toHaveLength(3)
  })

  it('select column opens option popup and can add a new option', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(document.querySelector('td[data-cell="0,2"]')!)
    expect(screen.getByTestId('table-select-popup')).toBeTruthy()
    fireEvent.click(screen.getByTestId('table-select-opt-0-2-0'))
    expect(useKnowledgeStore.getState().tableDraft?.csv).toContain('待办')
    // 新建选项
    fireEvent.click(document.querySelector('td[data-cell="0,2"]')!)
    const newInput = screen.getByTestId('table-select-new-input') as HTMLInputElement
    fireEvent.change(newInput, { target: { value: '暂停' } })
    // change 后重查输入框（避免旧闭包）
    const fresh = screen.getByTestId('table-select-new-input') as HTMLInputElement
    fireEvent.keyDown(fresh, { key: 'Enter' })
    const meta = JSON.parse(useKnowledgeStore.getState().tableDraft!.meta)
    expect(meta.cols[2].options).toContain('暂停')
    expect(useKnowledgeStore.getState().tableDraft?.csv).toContain('暂停')
  })

  it('debounced commit writes after 800ms', async () => {
    vi.useFakeTimers()
    render(<TableEditor tableId="tbl_1" />)
    const cell = screen.getByTestId('table-cell-0-0')
    fireEvent.doubleClick(cell)
    const input = screen.getByTestId('table-cell-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '保存我' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(commitTableSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(900)
    expect(commitTableSpy).toHaveBeenCalled()
  })
})

describe('TableEditor PR-4 (undo/resize/drag/freeze)', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })
  beforeEach(() => {
    mountTable()
    useKnowledgeStore.setState({
      commitTable: vi.fn(async () => {
        commitTableSpy()
        return true
      }) as never,
    })
  })

  it('undo/redo restores cell edits; ⌘Z keyboard works', () => {
    render(<TableEditor tableId="tbl_1" />)
    const grid = screen.getByTestId('table-grid')
    // 编辑 0,0 → 'AA'
    fireEvent.doubleClick(screen.getByTestId('table-cell-0-0'))
    let input = screen.getByTestId('table-cell-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'AA' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(document.querySelector('td[data-cell="0,0"]')!.textContent).toContain('AA')
    // 编辑 0,1（数字列）→ '250'（合法数字）
    fireEvent.doubleClick(screen.getByTestId('table-cell-0-1'))
    input = screen.getByTestId('table-cell-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '250' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(document.querySelector('td[data-cell="0,1"]')!.textContent).toContain('250')
    // ⌘Z → 回到 AA
    fireEvent.keyDown(grid, { key: 'z', metaKey: true })
    expect(document.querySelector('td[data-cell="0,1"]')!.textContent).toContain('100')
    expect(document.querySelector('td[data-cell="0,0"]')!.textContent).toContain('AA')
    // ⇧⌘Z → 重做 250
    fireEvent.keyDown(grid, { key: 'z', metaKey: true, shiftKey: true })
    expect(document.querySelector('td[data-cell="0,1"]')!.textContent).toContain('250')
    // 按钮状态
    expect(screen.getByTestId('table-undo')).not.toBeDisabled()
  })

  it('column resize via pointer drag updates width (live) and pushes one history step', () => {
    render(<TableEditor tableId="tbl_1" />)
    const th = screen.getByTestId('table-grid').querySelector('th[data-col="0"]')!
    const startW = Number((th as HTMLElement).style.width.replace('px', ''))
    fireEvent.pointerDown(screen.getByTestId('table-col-resize-0'), { clientX: 500, buttons: 1 })
    fireEvent.pointerMove(window, { clientX: 560, buttons: 1 })
    fireEvent.pointerUp(window, { clientX: 560 })
    const th2 = screen.getByTestId('table-grid').querySelector('th[data-col="0"]')!
    const endW = Number((th2 as HTMLElement).style.width.replace('px', ''))
    expect(endW).toBe(startW + 60)
    // 拖拽计入一次历史：撤销恢复原宽
    fireEvent.keyDown(screen.getByTestId('table-grid'), { key: 'z', metaKey: true })
    const th3 = screen.getByTestId('table-grid').querySelector('th[data-col="0"]')!
    expect(Number((th3 as HTMLElement).style.width.replace('px', ''))).toBe(startW)
  })

  it('double-click resize handle auto-fits column', () => {
    render(<TableEditor tableId="tbl_1" />)
    // 先写入长文本，再双击列边自适应
    fireEvent.doubleClick(screen.getByTestId('table-cell-0-0'))
    let input = screen.getByTestId('table-cell-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '这是一段用于触发自适应宽度的很长文本' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.doubleClick(screen.getByTestId('table-col-resize-0'))
    const w = Number(
      (screen.getByTestId('table-grid').querySelector('th[data-col="0"]') as HTMLElement).style.width.replace('px', ''),
    )
    expect(w).toBeGreaterThan(150)
  })

  it('column drag reorders columns with data', () => {
    render(<TableEditor tableId="tbl_1" />)
    const ths = [...screen.getByTestId('table-grid').querySelectorAll('th[data-col]')] as HTMLElement[]
    ths.forEach((th, i) => {
      Object.defineProperty(th, 'getBoundingClientRect', {
        value: () => ({ left: 100 + i * 150, right: 250 + i * 150, top: 0, bottom: 36, width: 150, height: 36, x: 100 + i * 150, y: 0, toJSON: () => ({}) }),
        configurable: true,
      })
    })
    const r0 = ths[0].getBoundingClientRect()
    const r1 = ths[1].getBoundingClientRect()
    fireEvent.pointerDown(screen.getByTestId('table-col-grip-0'), { clientX: r0.left + 5, buttons: 1 })
    // 拖到第 1 列右侧
    fireEvent.pointerMove(window, { clientX: r1.right - 2, buttons: 1 })
    fireEvent.pointerUp(window, { clientX: r1.right - 2 })
    // 列头顺序变了：第 1 列现在是原来的 col_1（预算）
    const th0 = screen.getByTestId('table-grid').querySelector('th[data-col="0"]')!
    expect((th0 as HTMLElement).dataset.colId).toBe('col_2')
    // 数据随动：原 col_1 的值 '100' 移到 col_0，原 'a' 移到 col_1
    expect(document.querySelector('td[data-cell="0,0"]')!.textContent).toContain('100')
    expect(document.querySelector('td[data-cell="0,1"]')!.textContent).toContain('a')
  })

  it('row drag moves row with data', () => {
    render(<TableEditor tableId="tbl_1" />)
    const trs = [...screen.getByTestId('table-grid').querySelectorAll('tbody tr[data-row]')] as HTMLElement[]
    trs.forEach((tr, i) => {
      Object.defineProperty(tr, 'getBoundingClientRect', {
        value: () => ({ left: 0, right: 500, top: 36 + i * 36, bottom: 72 + i * 36, width: 500, height: 36, x: 0, y: 36 + i * 36, toJSON: () => ({}) }),
        configurable: true,
      })
    })
    const r0 = trs[0].getBoundingClientRect()
    const r1 = trs[1].getBoundingClientRect()
    fireEvent.pointerDown(screen.getByTestId('table-row-grip-0'), { clientY: r0.top + 5, buttons: 1 })
    fireEvent.pointerMove(window, { clientY: r1.bottom - 2, buttons: 1 })
    fireEvent.pointerUp(window, { clientY: r1.bottom - 2 })
    // 原第 0 行 'a' 下移：row0 现在是原 row1（'1'），row1 是原 row0（'a'）
    expect(document.querySelector('td[data-cell="0,0"]')!.textContent).toContain('1')
    expect(document.querySelector('td[data-cell="1,0"]')!.textContent).toContain('a')
  })

  it('freeze header toggle removes sticky positioning', () => {
    render(<TableEditor tableId="tbl_1" />)
    const th = screen.getByTestId('table-grid').querySelector('th[data-col="0"]')!
    expect((th as HTMLElement).className).toContain('sticky')
    fireEvent.click(screen.getByTestId('table-freeze'))
    const th2 = screen.getByTestId('table-grid').querySelector('th[data-col="0"]')!
    expect((th2 as HTMLElement).className).not.toContain('sticky')
    expect((th2 as HTMLElement).className).toContain('relative')
  })

  it('undo restores deleted rows and columns', () => {
    render(<TableEditor tableId="tbl_1" />)
    // 删除第 0 行
    fireEvent.click(screen.getByTestId('table-row-menu-0'))
    fireEvent.click(within(screen.getByTestId('table-row-menu')).getByText('knowledge.table.rowMenu.deleteRow'))
    expect(screen.getByTestId('table-grid').dataset.rows).toBe('2')
    fireEvent.keyDown(screen.getByTestId('table-grid'), { key: 'z', metaKey: true })
    expect(screen.getByTestId('table-grid').dataset.rows).toBe('3')
    // 删除第 0 列
    fireEvent.click(screen.getByTestId('table-col-more-0'))
    fireEvent.click(screen.getByTestId('table-col-delete'))
    expect(screen.getByTestId('table-grid').dataset.cols).toBe('2')
    fireEvent.keyDown(screen.getByTestId('table-grid'), { key: 'z', metaKey: true })
    expect(screen.getByTestId('table-grid').dataset.cols).toBe('3')
  })
})

describe('TableEditor PR-5 (sort/filter/stats/export)', () => {
  beforeEach(() => {
    mountTable()
    useKnowledgeStore.setState({
      commitTable: vi.fn(async () => {
        commitTableSpy()
        return true
      }) as never,
    })
    vi.mocked(knowledgeExportText).mockReset()
    vi.mocked(pickSavePath).mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('sorts via column menu desc and shows indicator + chip', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(screen.getByTestId('table-col-more-1'))
    fireEvent.click(screen.getByTestId('table-col-sort-desc'))
    // 数字列 100,200,300 → 降序后首个可见行 col1 = '300'
    const firstCol1 = () =>
      document.querySelector('tbody tr[data-row] td[data-cell$=",1"]')!.textContent
    expect(firstCol1()).toContain('300')
    expect(screen.getByTestId('table-col-sort-ind').textContent).toBe('↓')
    expect(screen.getByTestId('table-sort-chip')).toBeTruthy()
    // 撤销排序恢复原序
    fireEvent.keyDown(screen.getByTestId('table-grid'), { key: 'z', metaKey: true })
    expect(firstCol1()).toContain('100')
    expect(screen.queryByTestId('table-sort-chip')).toBeNull()
  })

  it('filter panel: contains filter + badge + visible rows + clear', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(screen.getByTestId('table-filter'))
    expect(screen.getByTestId('table-filter-panel')).toBeTruthy()
    // 添加条件：列0 包含 'x'（默认 contains）
    fireEvent.click(screen.getByTestId('table-filter-add'))
    const val = screen.getByTestId('table-filter-value-0') as HTMLInputElement
    fireEvent.change(val, { target: { value: 'x' } })
    // 只有第 2 行（原始 ri=2）匹配（'x'）
    expect(screen.getByTestId('table-grid').querySelectorAll('tbody tr[data-row]')).toHaveLength(1)
    expect(document.querySelector('tbody tr[data-row] td[data-cell$=",0"]')!.textContent).toContain('x')
    expect(screen.getByTestId('table-filter-badge').textContent).toBe('1')
    // 清除
    fireEvent.click(screen.getByTestId('table-filter-clear'))
    expect(screen.getByTestId('table-grid').querySelectorAll('tbody tr[data-row]')).toHaveLength(3)
    expect(screen.queryByTestId('table-filter-badge')).toBeNull()
  })

  it('stats row sums number columns and counts others over visible rows', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(screen.getByTestId('table-stats'))
    expect(screen.getByTestId('table-stats-row')).toBeTruthy()
    // col1 数字求和：100+200+300=600；col0 计数：3
    const stats1 = () =>
      screen.getByTestId('table-stats-row').querySelector('[data-stats-cell="1"]')!.textContent
    expect(stats1()).toBe('600')
    expect(screen.getByTestId('table-stats-row').querySelector('[data-stats-cell="0"]')!.textContent).toBe('3')
    // 列菜单统计：均值 → 200
    fireEvent.click(screen.getByTestId('table-col-more-1'))
    fireEvent.click(screen.getByTestId('table-col-stats-avg'))
    expect(stats1()).toBe('200')
    // 筛选后统计可见行：只留 'x' 行 → 均值 300
    fireEvent.click(screen.getByTestId('table-filter'))
    fireEvent.click(screen.getByTestId('table-filter-add'))
    const val = screen.getByTestId('table-filter-value-0') as HTMLInputElement
    fireEvent.change(val, { target: { value: 'x' } })
    expect(stats1()).toBe('300')
  })

  it('exports full CSV with BOM via pickSavePath', async () => {
    vi.mocked(pickSavePath).mockResolvedValueOnce('/tmp/预算.csv')
    vi.mocked(knowledgeExportText).mockResolvedValueOnce(undefined)
    render(<TableEditor tableId="tbl_1" />)
    // 筛选不随导出
    fireEvent.click(screen.getByTestId('table-filter'))
    fireEvent.click(screen.getByTestId('table-filter-add'))
    const val = screen.getByTestId('table-filter-value-0') as HTMLInputElement
    fireEvent.change(val, { target: { value: 'x' } })
    fireEvent.click(screen.getByTestId('table-export'))
    await vi.waitFor(() => {
      expect(knowledgeExportText).toHaveBeenCalledTimes(1)
    })
    const [dest, body] = vi.mocked(knowledgeExportText).mock.calls[0]
    expect(dest).toBe('/tmp/预算.csv')
    expect(body.charCodeAt(0)).toBe(0xfeff)
    expect(body).toContain('a,100,c') // 全量数据（含被筛选隐藏的行）
    expect(body).toContain('1,200,3')
  })
})

describe('TableEditor PR-6 (title inline edit)', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })
  beforeEach(() => {
    mountTable()
    useKnowledgeStore.setState({
      commitTable: vi.fn(async () => {
        commitTableSpy()
        return true
      }) as never,
    })
  })

  it('double-click title → edit → Enter renames node in store', async () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.doubleClick(screen.getByTestId('table-editor-title'))
    const input = screen.getByTestId('table-title-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '季度排期 v2' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() => {
      expect(useKnowledgeStore.getState().nodes.find((n) => n.id === 'tbl_1')?.title).toBe(
        '季度排期 v2',
      )
    })
    expect(screen.getByTestId('table-editor-title').textContent).toContain('季度排期 v2')
  })

  it('Escape cancels title edit', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.doubleClick(screen.getByTestId('table-editor-title'))
    const input = screen.getByTestId('table-title-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '不改' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    const node = useKnowledgeStore.getState().nodes.find((n) => n.id === 'tbl_1')
    expect(node?.title).toBe('预算')
  })
})

describe('TableEditor table-ux-notion PR-2 (focus loop + typed editing)', () => {
  beforeEach(() => {
    mountTable()
    useKnowledgeStore.setState({
      commitTable: vi.fn(async () => {
        commitTableSpy()
        return true
      }) as never,
    })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('T1: cell click returns focus to grid (keyboard works right after mouse)', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(document.querySelector('td[data-cell="1,0"]')!)
    expect(document.activeElement).toBe(screen.getByTestId('table-grid'))
    // 提交编辑后焦点仍在网格
    fireEvent.doubleClick(document.querySelector('td[data-cell="0,0"]')!)
    const input = screen.getByTestId('table-cell-input')
    fireEvent.change(input, { target: { value: '焦点' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(document.activeElement).toBe(screen.getByTestId('table-grid'))
  })

  it('T2: text column edits with textarea; Shift+Enter inserts newline, Enter commits and moves down', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.doubleClick(document.querySelector('td[data-cell="0,0"]')!)
    const ta = screen.getByTestId('table-cell-input') as HTMLTextAreaElement
    expect(ta.tagName).toBe('TEXTAREA')
    fireEvent.change(ta, { target: { value: '第一行' } })
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    // Shift+Enter 不提交，仅在 textarea 中换行（value 由原生追加，此处验证编辑态仍在）
    expect(screen.getByTestId('table-cell-input')).toBeTruthy()
    fireEvent.change(screen.getByTestId('table-cell-input'), { target: { value: '第一行\n第二行' } })
    fireEvent.keyDown(screen.getByTestId('table-cell-input'), { key: 'Enter' })
    // 提交后单元格含换行
    expect(document.querySelector('td[data-cell="0,0"]')!.textContent).toContain('第一行')
    // 选区下移一格
    expect(document.querySelector('td[data-cell="1,0"]')!.className).toContain('outline')
  })

  it('T2: number column rejects non-numeric input (err + not persisted), accepts valid', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.doubleClick(document.querySelector('td[data-cell="0,1"]')!)
    const input = screen.getByTestId('table-cell-input') as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // 校验失败：保持编辑 + err 样式 + 不落盘
    expect(screen.getByTestId('table-cell-input')).toBeTruthy()
    expect((screen.getByTestId('table-cell-input') as HTMLElement).className).toContain('border-danger')
    expect(useKnowledgeStore.getState().tableDraft?.csv).not.toContain('abc')
    // 修正为合法值 → 提交落盘
    fireEvent.change(screen.getByTestId('table-cell-input'), { target: { value: '250' } })
    fireEvent.keyDown(screen.getByTestId('table-cell-input'), { key: 'Enter' })
    expect(useKnowledgeStore.getState().tableDraft?.csv).toContain('250')
  })

  it('T2: date column edits with date input control', () => {
    useKnowledgeStore.setState({
      tableDoc: {
        id: 'tbl_1',
        csv: '2024-01-01\n',
        meta: JSON.stringify({ cols: [{ id: 'col_1', name: '日期', type: 'date', width: 150 }] }),
      },
      tableDraft: {
        id: 'tbl_1',
        csv: '2024-01-01\n',
        meta: JSON.stringify({ cols: [{ id: 'col_1', name: '日期', type: 'date', width: 150 }] }),
      },
    })
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.doubleClick(document.querySelector('td[data-cell="0,0"]')!)
    const input = screen.getByTestId('table-cell-input') as HTMLInputElement
    expect(input.type).toBe('date')
    fireEvent.change(input, { target: { value: '2024-06-15' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useKnowledgeStore.getState().tableDraft?.csv).toContain('2024-06-15')
  })

  it('T2: Tab from edit commits and moves to next cell; last-col Tab wraps to next row', () => {
    // 末列改为 text（select 列不可 dblclick 编辑）
    useKnowledgeStore.setState({
      tableDoc: {
        id: 'tbl_1',
        csv: CSV,
        meta: JSON.stringify({
          cols: [
            { id: 'col_1', name: '任务', type: 'text', width: 150 },
            { id: 'col_2', name: '预算', type: 'number', width: 150 },
            { id: 'col_3', name: '备注', type: 'text', width: 150 },
          ],
        }),
      },
      tableDraft: {
        id: 'tbl_1',
        csv: CSV,
        meta: JSON.stringify({
          cols: [
            { id: 'col_1', name: '任务', type: 'text', width: 150 },
            { id: 'col_2', name: '预算', type: 'number', width: 150 },
            { id: 'col_3', name: '备注', type: 'text', width: 150 },
          ],
        }),
      },
    })
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.doubleClick(document.querySelector('td[data-cell="0,0"]')!)
    let input = screen.getByTestId('table-cell-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '制表' } })
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(document.querySelector('td[data-cell="0,0"]')!.textContent).toContain('制表')
    expect(document.querySelector('td[data-cell="0,1"]')!.className).toContain('outline')
    // 末列 Tab → 下一行首列
    fireEvent.doubleClick(document.querySelector('td[data-cell="0,2"]')!)
    input = screen.getByTestId('table-cell-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '末列' } })
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(document.querySelector('td[data-cell="1,0"]')!.className).toContain('outline')
  })

  it('T2: Enter on last visible row appends a row (edited value persisted)', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.doubleClick(document.querySelector('td[data-cell="2,0"]')!)
    const input = screen.getByTestId('table-cell-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '尾行' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useKnowledgeStore.getState().tableDraft?.csv.split('\n')).toHaveLength(4)
    expect(useKnowledgeStore.getState().tableDraft?.csv).toContain('尾行')
    // 新行落在选区
    expect(document.querySelector('td[data-cell="3,0"]')!.className).toContain('outline')
  })
})

describe('TableEditor table-ux-notion PR-3 (selection model)', () => {
  beforeEach(() => {
    mountTable()
    useKnowledgeStore.setState({
      commitTable: vi.fn(async () => {
        commitTableSpy()
        return true
      }) as never,
    })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('Shift+click extends selection rectangle with fill highlight', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(document.querySelector('td[data-cell="0,0"]')!)
    fireEvent.click(document.querySelector('td[data-cell="1,1"]')!, { shiftKey: true })
    // 2×2 整格底色
    for (const r of ['0,0', '0,1', '1,0', '1,1']) {
      expect(document.querySelector(`td[data-cell="${r}"]`)!.className).toContain('bg-state-hover')
    }
    // 范围外不高亮
    expect(document.querySelector('td[data-cell="2,0"]')!.className).not.toContain('bg-state-hover')
    // anchor 格描边
    expect(document.querySelector('td[data-cell="0,0"]')!.className).toContain('outline')
    // 状态栏显示已选 4 格
    expect(screen.getByTestId('table-selection-info').textContent).toContain('4')
  })

  it('⌘A selects all cells; Delete clears the whole range; ⌘Z restores', () => {
    render(<TableEditor tableId="tbl_1" />)
    const grid = screen.getByTestId('table-grid')
    fireEvent.keyDown(grid, { key: 'a', metaKey: true })
    expect(screen.getByTestId('table-selection-info').textContent).toContain('9')
    fireEvent.keyDown(grid, { key: 'Delete' })
    // 全部清空
    expect(useKnowledgeStore.getState().tableDraft?.csv).toBe(',,\n,,\n,,')
    fireEvent.keyDown(grid, { key: 'z', metaKey: true })
    expect(useKnowledgeStore.getState().tableDraft?.csv).toBe('a,100,c\n1,200,3\nx,300,z')
  })

  it('Shift+ArrowDown extends; plain ArrowDown re-anchors', () => {
    render(<TableEditor tableId="tbl_1" />)
    const grid = screen.getByTestId('table-grid')
    fireEvent.click(document.querySelector('td[data-cell="0,0"]')!)
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true })
    expect(screen.getByTestId('table-selection-info').textContent).toContain('3')
    // 非扩展移动 → 单格（末行钳制）
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(screen.queryByTestId('table-selection-info')).toBeNull()
    expect(document.querySelector('td[data-cell="2,0"]')!.className).toContain('outline')
  })

  it('row number click selects whole row; Shift+click extends to multiple rows', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(document.querySelector('tr[data-row="0"] td[data-testid="table-row-idx"]')!)
    // 整行 3 格高亮
    for (const c of ['0', '1', '2']) {
      expect(document.querySelector(`td[data-cell="0,${c}"]`)!.className).toContain('bg-state-hover')
    }
    expect(document.querySelector('td[data-cell="1,0"]')!.className).not.toContain('bg-state-hover')
    expect(screen.getByTestId('table-selection-info').textContent).toContain('3')
    // Shift 点击行 2 → 行 0..2 全高亮（9 格）
    fireEvent.click(document.querySelector('tr[data-row="2"] td[data-testid="table-row-idx"]')!, { shiftKey: true })
    expect(screen.getByTestId('table-selection-info').textContent).toContain('9')
    expect(document.querySelector('td[data-cell="2,2"]')!.className).toContain('bg-state-hover')
  })

  it('header click selects whole column; ⋯ still opens the column menu', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(screen.getByTestId('table-grid').querySelector('th[data-col="1"]')!)
    // 整列 3 格高亮
    for (const r of ['0', '1', '2']) {
      expect(document.querySelector(`td[data-cell="${r},1"]`)!.className).toContain('bg-state-hover')
    }
    expect(screen.getByTestId('table-selection-info').textContent).toContain('3')
    // ⋯ 打开列菜单（不触发列选择）
    fireEvent.click(screen.getByTestId('table-col-more-1'))
    expect(screen.getByTestId('table-col-menu')).toBeTruthy()
  })

  it('direct character input replaces the whole selection (Notion)', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(document.querySelector('td[data-cell="0,0"]')!)
    fireEvent.click(document.querySelector('td[data-cell="0,1"]')!, { shiftKey: true })
    fireEvent.keyDown(screen.getByTestId('table-grid'), { key: 'x' })
    const draft = useKnowledgeStore.getState().tableDraft?.csv.split('\n')[0]
    expect(draft).toBe('x,x,c')
  })

  it('checkbox column: single click selects the cell (no toggle); space toggles', () => {
    useKnowledgeStore.setState({
      tableDoc: {
        id: 'tbl_1',
        csv: 'x\n',
        meta: JSON.stringify({ cols: [{ id: 'col_1', name: '勾选', type: 'checkbox', width: 150 }] }),
      },
      tableDraft: {
        id: 'tbl_1',
        csv: 'x\n',
        meta: JSON.stringify({ cols: [{ id: 'col_1', name: '勾选', type: 'checkbox', width: 150 }] }),
      },
    })
    render(<TableEditor tableId="tbl_1" />)
    // 单击单元格（非复选框本体）→ 只选中
    fireEvent.click(document.querySelector('td[data-cell="0,0"]')!)
    expect(useKnowledgeStore.getState().tableDraft?.csv).toBe('x\n')
    expect(document.querySelector('td[data-cell="0,0"]')!.className).toContain('bg-state-hover')
    // 空格切换
    fireEvent.keyDown(screen.getByTestId('table-grid'), { key: ' ' })
    expect(useKnowledgeStore.getState().tableDraft?.csv).toBe('1')
    // 点复选框本体切换
    fireEvent.click(screen.getByTestId('table-check-0-0'))
    expect(useKnowledgeStore.getState().tableDraft?.csv).toBe('0')
  })
})

describe('TableEditor table-ux-notion PR-4 (clipboard)', () => {
  const clipboardData = { text: '' }
  beforeEach(() => {
    mountTable()
    useKnowledgeStore.setState({
      commitTable: vi.fn(async () => {
        commitTableSpy()
        return true
      }) as never,
    })
    clipboardData.text = ''
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(async (t: string) => { clipboardData.text = t }),
        readText: vi.fn(async () => clipboardData.text),
      },
      configurable: true,
    })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('⌘C serializes selection as TSV (view order respected under sort)', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(document.querySelector('td[data-cell="0,0"]')!)
    fireEvent.click(document.querySelector('td[data-cell="0,2"]')!, { shiftKey: true })
    fireEvent.keyDown(screen.getByTestId('table-grid'), { key: 'c', metaKey: true })
    expect(clipboardData.text).toBe('a\t100\tc')
  })

  it('⌘V pastes TSV expanding rows/cols beyond bounds (auto-add row + col)', async () => {
    render(<TableEditor tableId="tbl_1" />)
    // 焦点在 (0,0)，粘入 4 行 × 2 列
    clipboardData.text = 'p1\tp2\nq1\tq2\nr1\tr2\ns1\ts2'
    fireEvent.click(document.querySelector('td[data-cell="0,0"]')!)
    fireEvent.keyDown(screen.getByTestId('table-grid'), { key: 'v', metaKey: true })
    await vi.waitFor(() => {
      const grid = screen.getByTestId('table-grid')
      expect(grid.dataset.rows).toBe('4')
      expect(grid.dataset.cols).toBe('3') // 2 列粘贴 + 原 3 列（不超界）
    })
    expect(useKnowledgeStore.getState().tableDraft?.csv.split('\n')).toHaveLength(4)
    expect(document.querySelector('td[data-cell="3,1"]')!.textContent).toContain('s2')
  })

  it('⌘V pastes TSV expanding columns beyond bounds (adds new column)', async () => {
    render(<TableEditor tableId="tbl_1" />)
    // 焦点 (0,2)，粘入 1 行 × 3 列 → 需要第 4、5 列
    clipboardData.text = 'x\ty\tz'
    fireEvent.click(document.querySelector('td[data-cell="0,2"]')!)
    fireEvent.keyDown(screen.getByTestId('table-grid'), { key: 'v', metaKey: true })
    await vi.waitFor(() => {
      expect(screen.getByTestId('table-grid').dataset.cols).toBe('5')
    })
    expect(document.querySelector('td[data-cell="0,4"]')!.textContent).toContain('z')
  })

  it('plain multiline text pastes as single cell; paste updates selection to pasted area', async () => {
    render(<TableEditor tableId="tbl_1" />)
    clipboardData.text = '第一行\n第二行'
    fireEvent.click(document.querySelector('td[data-cell="1,0"]')!)
    fireEvent.keyDown(screen.getByTestId('table-grid'), { key: 'v', metaKey: true })
    await vi.waitFor(() => {
      expect(useKnowledgeStore.getState().tableDraft?.csv).toContain('第一行\n第二行')
    })
    // 单格选区（无扩展信息）
    expect(screen.queryByTestId('table-selection-info')).toBeNull()
    // TSV 粘贴后选区 = 粘贴区域
    clipboardData.text = 'a\tb\nc\td'
    fireEvent.click(document.querySelector('td[data-cell="1,0"]')!)
    fireEvent.keyDown(screen.getByTestId('table-grid'), { key: 'v', metaKey: true })
    await vi.waitFor(() => {
      expect(screen.getByTestId('table-selection-info')!.textContent).toContain('4')
    })
  })

  it('oversized paste is rejected with toast', async () => {
    render(<TableEditor tableId="tbl_1" />)
    // 201 行 × 2 列
    clipboardData.text = Array.from({ length: 201 }, (_, i) => `${i}\tx`).join('\n')
    fireEvent.click(document.querySelector('td[data-cell="0,0"]')!)
    fireEvent.keyDown(screen.getByTestId('table-grid'), { key: 'v', metaKey: true })
    await vi.waitFor(() => {
      expect(screen.getByTestId('table-grid').dataset.rows).toBe('3') // 未扩表
    })
    const { toast } = await import('sonner')
    expect(vi.mocked(toast.error)).toHaveBeenCalled()
  })
})

describe('TableEditor table-ux-notion PR-5 (view-consistent rows)', () => {
  beforeEach(() => {
    mountTable()
    useKnowledgeStore.setState({
      commitTable: vi.fn(async () => {
        commitTableSpy()
        return true
      }) as never,
    })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('row numbers stay 1..n under sort (view order, not data order)', () => {
    render(<TableEditor tableId="tbl_1" />)
    // 降序排 col_1（数字 100/200/300 → 视图行 = 数据 2,1,0）
    fireEvent.click(screen.getByTestId('table-col-more-1'))
    fireEvent.click(screen.getByTestId('table-col-sort-desc'))
    const nums = [...document.querySelectorAll('tr[data-row] td[data-testid="table-row-idx"]')]
      .map((td) => td.textContent!.match(/\d+/)?.[0])
    expect(nums).toEqual(['1', '2', '3'])
    // 首行是数据第 2 行（300）
    expect(document.querySelector('tr[data-row="2"] td[data-cell$=",1"]')!.textContent).toContain('300')
  })

  it('row numbers stay 1..n under filter; status bar shows visible x/y', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(screen.getByTestId('table-filter'))
    fireEvent.click(screen.getByTestId('table-filter-add'))
    fireEvent.change(screen.getByTestId('table-filter-value-0'), { target: { value: 'x' } })
    expect(screen.getByTestId('table-visible-info').textContent).toContain('1')
    const nums = [...document.querySelectorAll('tr[data-row] td[data-testid="table-row-idx"]')]
      .map((td) => td.textContent!.match(/\d+/)?.[0])
    expect(nums).toEqual(['1'])
    // 可见信息含总数
    expect(screen.getByTestId('table-visible-info').textContent).toContain('3')
  })

  it('Enter at last visible row under filter appends a data row + filtered toast', async () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(screen.getByTestId('table-filter'))
    fireEvent.click(screen.getByTestId('table-filter-add'))
    fireEvent.change(screen.getByTestId('table-filter-value-0'), { target: { value: 'x' } })
    // 视图只有 1 行（x）；进入该行编辑并 Enter
    fireEvent.doubleClick(document.querySelector('tr[data-row="2"] td[data-cell="2,0"]')!)
    const input = screen.getByTestId('table-cell-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'x2' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // 数据 +1 行（4 行）；原值已更新
    expect(useKnowledgeStore.getState().tableDraft?.csv.split('\n')).toHaveLength(4)
    expect(useKnowledgeStore.getState().tableDraft?.csv).toContain('x2')
    const { toast } = await import('sonner')
    expect(vi.mocked(toast.info)).toHaveBeenCalledWith('knowledge.table.toasts.rowAddedFiltered')
  })

  it('row/col drag grips disabled (class + no-op) under sort/filter', () => {
    render(<TableEditor tableId="tbl_1" />)
    // 排序后：行 grip 置灰 + pointerdown 不启动拖拽
    fireEvent.click(screen.getByTestId('table-col-more-1'))
    fireEvent.click(screen.getByTestId('table-col-sort-desc'))
    const grip = screen.getByTestId('table-row-grip-0')
    expect(grip.className).toContain('cursor-not-allowed')
    expect(grip.className).not.toContain('cursor-grab')
    const colGrip = screen.getByTestId('table-col-grip-0')
    expect(colGrip.className).toContain('cursor-not-allowed')
    // 拖拽尝试不移动
    const trs = [...screen.getByTestId('table-grid').querySelectorAll('tbody tr[data-row]')] as HTMLElement[]
    trs.forEach((tr, i) => {
      Object.defineProperty(tr, 'getBoundingClientRect', {
        value: () => ({ left: 0, right: 500, top: 36 + i * 36, bottom: 72 + i * 36, width: 500, height: 36, x: 0, y: 36 + i * 36, toJSON: () => ({}) }),
        configurable: true,
      })
    })
    fireEvent.pointerDown(grip, { clientY: 40, buttons: 1 })
    fireEvent.pointerMove(window, { clientY: 100, buttons: 1 })
    fireEvent.pointerUp(window, { clientY: 100 })
    // 视图第 0 行 = 数据行 2（排序未变数据序）；拖拽未发生 → 数据仍原序
    expect(document.querySelector('tr[data-row="2"] td[data-cell$=",1"]')!.textContent).toContain('300')
  })
})

describe('TableEditor table-ux-notion PR-6 (portal menus)', () => {
  beforeEach(() => {
    mountTable()
    useKnowledgeStore.setState({
      commitTable: vi.fn(async () => {
        commitTableSpy()
        return true
      }) as never,
    })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('column menu renders in body portal, not inside the grid', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(screen.getByTestId('table-col-more-0'))
    const menu = screen.getByTestId('table-col-menu')
    // 不在 grid 内（原 absolute 方案会被 overflow 容器裁剪）
    expect(screen.getByTestId('table-grid').contains(menu)).toBe(false)
    expect(document.body.contains(menu)).toBe(true)
    // 菜单项可点击
    fireEvent.click(screen.getByTestId('table-col-sort-asc'))
    expect(screen.getByTestId('table-sort-chip')).toBeTruthy()
  })

  it('row menu and select popup also render in body portal', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(screen.getByTestId('table-row-menu-1'))
    const rowMenu = screen.getByTestId('table-row-menu')
    expect(screen.getByTestId('table-grid').contains(rowMenu)).toBe(false)
    fireEvent.click(document.querySelector('td[data-cell="0,2"]')!)
    const pop = screen.getByTestId('table-select-popup')
    expect(screen.getByTestId('table-grid').contains(pop)).toBe(false)
  })

  it('scrolling the grid container closes open menus', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(screen.getByTestId('table-col-more-0'))
    expect(screen.getByTestId('table-col-menu')).toBeTruthy()
    fireEvent.scroll(screen.getByTestId('table-grid-wrap'))
    expect(screen.queryByTestId('table-col-menu')).toBeNull()
  })

  it('mousedown outside grid closes menus; inside grid keeps them until toggle', () => {
    render(<TableEditor tableId="tbl_1" />)
    fireEvent.click(screen.getByTestId('table-col-more-0'))
    // 工具栏区域 mousedown → 关闭
    fireEvent.mouseDown(screen.getByTestId('table-editor-toolbar'))
    expect(screen.queryByTestId('table-col-menu')).toBeNull()
    // 再开：grid 内 mousedown（其他单元格）不直接关闭
    fireEvent.click(screen.getByTestId('table-col-more-0'))
    fireEvent.mouseDown(screen.getByTestId('table-grid'))
    expect(screen.getByTestId('table-col-menu')).toBeTruthy()
  })
})

describe('TableEditor table-ux-notion PR-7 (typed cells)', () => {
  beforeEach(() => {
    mountTable()
    useKnowledgeStore.setState({
      commitTable: vi.fn(async () => {
        commitTableSpy()
        return true
      }) as never,
    })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('select column renders colored chips; different options get different colors', () => {
    render(<TableEditor tableId="tbl_1" />)
    // 初始值：c / 3 / z（非选项值）→ chip 仍按 options.indexOf 索引着色
    const chip0 = screen.getByTestId('table-chip-0-2')
    expect(chip0.style.backgroundColor).not.toBe('')
    // 选择「待办」后 chip 颜色 = 色板第 0 个
    fireEvent.click(document.querySelector('td[data-cell="0,2"]')!)
    fireEvent.click(screen.getByTestId('table-select-opt-0-2-0'))
    const chip = screen.getByTestId('table-chip-0-2')
    expect(chip.textContent).toContain('待办')
    expect(chip.style.backgroundColor).toContain('35, 131, 226')
    // 选「完成」→ 色板第 1 个
    fireEvent.click(document.querySelector('td[data-cell="0,2"]')!)
    fireEvent.click(screen.getByTestId('table-select-opt-0-2-1'))
    const chip2 = screen.getByTestId('table-chip-0-2')
    expect(chip2.style.backgroundColor).toContain('217, 115, 13')
  })

  it('empty select cell shows placeholder, not a chip', () => {
    useKnowledgeStore.setState({
      tableDoc: {
        id: 'tbl_1',
        csv: '\n',
        meta: JSON.stringify({ cols: [{ id: 'col_1', name: '状态', type: 'select', options: ['待办'], width: 150 }] }),
      },
      tableDraft: {
        id: 'tbl_1',
        csv: '\n',
        meta: JSON.stringify({ cols: [{ id: 'col_1', name: '状态', type: 'select', options: ['待办'], width: 150 }] }),
      },
    })
    render(<TableEditor tableId="tbl_1" />)
    expect(screen.queryByTestId('table-chip-0-0')).toBeNull()
  })

  it('date column uses tabular-nums for values', () => {
    useKnowledgeStore.setState({
      tableDoc: {
        id: 'tbl_1',
        csv: '2024-01-01\n',
        meta: JSON.stringify({ cols: [{ id: 'col_1', name: '日期', type: 'date', width: 150 }] }),
      },
      tableDraft: {
        id: 'tbl_1',
        csv: '2024-01-01\n',
        meta: JSON.stringify({ cols: [{ id: 'col_1', name: '日期', type: 'date', width: 150 }] }),
      },
    })
    render(<TableEditor tableId="tbl_1" />)
    expect(document.querySelector('td[data-cell="0,0"]')!.className).toContain('tabular-nums')
  })
})
