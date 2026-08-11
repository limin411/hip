/**
 * 轻表格编辑器（knowledge-table PR-3 骨架）。
 *
 * 交互契约（与 knowledge-table-preview.html 场景二一致）：
 * - 单击选中格；双击 / Enter / F2 / 直接输入字符进入编辑；Esc 取消
 * - Tab/Shift+Tab 换列（行尾自动换行）；Enter 下移（末行自动加行）；↑↓←→ 移动
 * - Delete 清空；勾选列单击/空格切换；单选列点击弹选项（可新建选项）
 * - 列头点击 → 列菜单（重命名/类型/插列/删列）；行尾 ⋯ → 行菜单（插行/复制/删行）
 * - 冻结首行 + 行号列（sticky）；数字列右对齐
 * - 变更 → store.updateTableDraft + 800ms 防抖 commitTable（落盘）
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowUpDown,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  FileDown,
  Filter,
  Hash,
  MoreHorizontal,
  Plus,
  Redo2,
  Sigma,
  Snowflake,
  Table2,
  Type,
  Undo2,
  X,
} from 'lucide-react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { knowledgeExportText } from '@/ipc/knowledge'
import { pickSavePath } from '@/ipc/dialog'
import { cn } from '@/lib/utils'
import {
  clampWidth,
  createColumn,
  createTableHistory,
  csvToTable,
  matchesAllFilters,
  metaFromTable,
  sortRowIndices,
  tableToCsv,
  avgRows,
  countNonEmpty,
  sumRows,
  type TableColType,
  type TableData,
  type TableFilter,
  type TableFilterOp,
  type TableSnapshot,
  type TableSortState,
} from '@/domain/knowledge/tableModel'

const TYPE_ICONS: Record<TableColType, typeof Type> = {
  text: Type,
  number: Hash,
  checkbox: CheckSquare,
  date: CalendarDays,
  select: ChevronDown,
}

const COL_TYPE_ORDER: TableColType[] = ['text', 'number', 'checkbox', 'date', 'select']

interface CellPos {
  ri: number
  ci: number
}

export function TableEditor({ tableId }: { tableId: string }) {
  const { t } = useTranslation()
  const draft = useKnowledgeStore((s) => s.tableDraft)
  const tableSaveState = useKnowledgeStore((s) => s.tableSaveState)
  const commitTable = useKnowledgeStore((s) => s.commitTable)
  const updateTableDraft = useKnowledgeStore((s) => s.updateTableDraft)
  const tableTitle =
    useKnowledgeStore((s) => s.nodes.find((n) => n.id === tableId)?.title) ??
    t('knowledge.table.untitled')

  const [table, setTable] = useState<TableData>(() =>
    csvToTable(draft?.csv ?? '', draft?.meta ?? ''),
  )
  const [sel, setSel] = useState<CellPos>({ ri: 0, ci: 0 })
  const [editing, setEditing] = useState<{ ri: number; ci: number; value: string } | null>(null)
  const [colMenuCi, setColMenuCi] = useState<number | null>(null)
  const [rowMenuRi, setRowMenuRi] = useState<number | null>(null)
  const [renamingCi, setRenamingCi] = useState<number | null>(null)
  const [renameText, setRenameText] = useState('')
  const [selectPopup, setSelectPopup] = useState<CellPos | null>(null)
  const [newOptionText, setNewOptionText] = useState('')
  const [freezeHeader, setFreezeHeader] = useState(true)
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  /** 排序（列 id 引用 meta col id；数据行不变，视图重排；可撤销）。 */
  const [sortState, setSortState] = useState<TableSortState | null>(null)
  /** 筛选（仅视图，不写文件）。 */
  const [filters, setFilters] = useState<TableFilter[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  /** 统计行开关 + 逐列模式（缺省：数字→求和，其余→计数）。 */
  const [statsOn, setStatsOn] = useState(false)
  const [colStats, setColStats] = useState<Record<number, 'sum' | 'avg' | 'count' | 'off'>>({})
  /** 撤销栈版本戳：任何 push/undo/redo 后 +1 以刷新按钮启用态。 */
  const [histTick, setHistTick] = useState(0)

  const historyRef = useRef(createTableHistory())
  const tableRef = useRef(table)
  tableRef.current = table
  const sortRef = useRef<TableSortState | null>(sortState)
  sortRef.current = sortState

  const saveTimer = useRef<number | null>(null)
  const commitRef = useRef(commitTable)
  commitRef.current = commitTable
  const updateRef = useRef(updateTableDraft)
  updateRef.current = updateTableDraft
  const idRef = useRef(tableId)
  idRef.current = tableId

  /** 变更入口：更新本地状态 → 同步 store 草稿 → 防抖落盘。
   *  默认推入历史（变更后快照）；`history: false` 用于拖拽 live 态。 */
  const onChange = (next: TableData, opts?: { history?: boolean }) => {
    tableRef.current = next
    setTable(next)
    const csv = tableToCsv(next)
    const meta = JSON.stringify(metaFromTable(next))
    updateRef.current(idRef.current, csv, meta)
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void commitRef.current(idRef.current)
    }, 800)
    if (opts?.history !== false) {
      historyRef.current.push({ table: next, sort: sortRef.current })
      setHistTick((t) => t + 1)
    }
  }

  /** 拖拽等 live 变更结束后补推一步历史（当前状态入栈）。
   *  `sortOverride`：排序类变更的推入发生在 setState 之前，需显式携带目标排序态。 */
  const pushHistoryStep = (sortOverride?: TableSortState | null) => {
    historyRef.current.push({
      table: tableRef.current,
      sort: sortOverride === undefined ? sortRef.current : sortOverride,
    })
    setHistTick((t) => t + 1)
  }

  const applySnapshot = (snap: TableSnapshot) => {
    setSel({ ri: 0, ci: 0 })
    setColMenuCi(null)
    setRowMenuRi(null)
    setSelectPopup(null)
    setEditing(null)
    setSortState(snap.sort)
    onChange(snap.table, { history: false })
  }

  const undo = () => {
    const snap = historyRef.current.undo()
    if (!snap) return
    setHistTick((t) => t + 1)
    applySnapshot(snap)
  }

  const redo = () => {
    const snap = historyRef.current.redo()
    if (!snap) return
    setHistTick((t) => t + 1)
    applySnapshot(snap)
  }

  // 打开时初始化历史基线。
  useEffect(() => {
    historyRef.current.reset({ table: tableRef.current, sort: sortRef.current })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId])

  // 卸载时冲刷未落盘草稿（门禁兜底）。
  useEffect(() => {
    return () => {
      if (saveTimer.current != null) {
        window.clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      const st = useKnowledgeStore.getState()
      const d = st.tableDraft
      if (d && d.id === idRef.current && st.tableSaveState === 'saving') {
        void st.commitTable(d.id)
      }
    }
  }, [])

  const colName = (ci: number) =>
    table.cols[ci]?.name?.trim() || t('knowledge.table.columnLabel', { n: ci + 1 })

  const commitEdit = () => {
    if (!editing) return
    const { ri, ci, value } = editing
    const next = structuredClone(table)
    next.rows[ri] = [...next.rows[ri]]
    next.rows[ri][ci] = value
    onChange(next)
    setEditing(null)
    setSel({ ri, ci })
  }

  const setCell = (ri: number, ci: number, value: string) => {
    const next = structuredClone(table)
    next.rows[ri] = [...next.rows[ri]]
    next.rows[ri][ci] = value
    onChange(next)
    setSel({ ri, ci })
  }

  const moveSel = (ri: number, ci: number) => {
    const rows = table.rows.length
    const cols = table.cols.length
    setSel({ ri: Math.max(0, Math.min(rows - 1, ri)), ci: Math.max(0, Math.min(cols - 1, ci)) })
  }

  /** 网格键盘导航（选中态）。编辑态由 input 自行处理。 */
  const handleGridKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey) {
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      return
    }
    if (e.altKey) return
    const { ri, ci } = sel
    switch (e.key) {
      case 'Enter': {
        e.preventDefault()
        const isShift = e.shiftKey
        let nextRow = isShift ? ri - 1 : ri + 1
        if (nextRow >= table.rows.length) {
          onChange({ cols: table.cols, rows: [...table.rows.map((r) => [...r]), Array(table.cols.length).fill('')] })
          nextRow = table.rows.length
        }
        setSel({ ri: Math.max(0, nextRow), ci })
        break
      }
      case 'Tab': {
        e.preventDefault()
        if (e.shiftKey) {
          if (ci > 0) setSel({ ri, ci: ci - 1 })
          else if (ri > 0) setSel({ ri: ri - 1, ci: table.cols.length - 1 })
        } else {
          if (ci < table.cols.length - 1) setSel({ ri, ci: ci + 1 })
          else {
            if (ri >= table.rows.length - 1) {
              onChange({ cols: table.cols, rows: [...table.rows.map((r) => [...r]), Array(table.cols.length).fill('')] })
            }
            setSel({ ri: Math.min(ri + 1, table.rows.length), ci: 0 })
          }
        }
        break
      }
      case 'ArrowDown':
        e.preventDefault()
        moveSel(ri + 1, ci)
        break
      case 'ArrowUp':
        e.preventDefault()
        moveSel(ri - 1, ci)
        break
      case 'ArrowLeft':
        e.preventDefault()
        moveSel(ri, ci - 1)
        break
      case 'ArrowRight':
        e.preventDefault()
        moveSel(ri, ci + 1)
        break
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        setCell(ri, ci, '')
        break
      case ' ':
        if (table.cols[ci]?.type === 'checkbox') {
          e.preventDefault()
          setCell(ri, ci, table.rows[ri]?.[ci] === '1' ? '0' : '1')
        }
        break
      case 'F2':
        e.preventDefault()
        setEditing({ ri, ci, value: table.rows[ri]?.[ci] ?? '' })
        break
      case 'Escape':
        setColMenuCi(null)
        setRowMenuRi(null)
        setSelectPopup(null)
        break
      default:
        // 直接输入字符进入编辑（单字符、非组合键）。
        if (e.key.length === 1 && !e.nativeEvent.isComposing) {
          e.preventDefault()
          setEditing({ ri, ci, value: e.key })
        }
    }
  }

  const addRow = (at?: number) => {
    const cols = table.cols.length
    const row = Array(cols).fill('')
    const rows = [...table.rows.map((r) => [...r])]
    rows.splice(at ?? rows.length, 0, row)
    onChange({ cols: table.cols, rows })
  }

  const duplicateRow = (ri: number) => {
    const rows = [...table.rows.map((r) => [...r])]
    rows.splice(ri + 1, 0, [...(rows[ri] ?? [])])
    onChange({ cols: table.cols, rows })
  }

  const deleteRow = (ri: number) => {
    if (table.rows.length <= 1) return
    const rows = table.rows.filter((_, i) => i !== ri)
    onChange({ cols: table.cols, rows })
    setRowMenuRi(null)
    toast.info(t('knowledge.table.toasts.rowDeleted'))
    setSel({ ri: Math.min(ri, rows.length - 1), ci: sel.ci })
  }

  const insertColumn = (ci: number, offset: 0 | 1) => {
    const at = ci + offset
    const col = createColumn('text', table)
    const cols = [...table.cols]
    cols.splice(at, 0, col)
    const rows = table.rows.map((r) => {
      const next = [...r]
      next.splice(at, 0, '')
      return next
    })
    onChange({ cols, rows })
    setColMenuCi(null)
  }

  const deleteColumn = (ci: number) => {
    if (table.cols.length <= 1) return
    const cols = table.cols.filter((_, i) => i !== ci)
    const rows = table.rows.map((r) => {
      const next = [...r]
      next.splice(ci, 1)
      return next
    })
    onChange({ cols, rows })
    setColMenuCi(null)
    toast.info(t('knowledge.table.toasts.columnDeleted'))
    setSel({ ri: sel.ri, ci: Math.min(sel.ci, cols.length - 1) })
  }

  const setColType = (ci: number, type: TableColType) => {
    const cols = table.cols.map((c, i) =>
      i === ci ? { ...c, type, ...(type !== 'select' ? { options: undefined } : {}) } : c,
    )
    onChange({ cols, rows: table.rows })
    setColMenuCi(null)
  }

  const toggleCheck = (ri: number, ci: number) => {
    const cur = table.rows[ri]?.[ci]
    setCell(ri, ci, cur === '1' ? '0' : '1')
  }

  const selectOption = (ri: number, ci: number, value: string) => {
    setCell(ri, ci, value)
    setSelectPopup(null)
  }

  const addSelectOption = (ri: number, ci: number) => {
    const v = newOptionText.trim()
    if (!v) return
    const options = [...(table.cols[ci]?.options ?? [])]
    if (!options.includes(v)) options.push(v)
    const cols = table.cols.map((c, i) => (i === ci ? { ...c, options } : c))
    const rows = table.rows.map((r, i) => {
      if (i !== ri) return r
      const nr = [...r]
      nr[ci] = v
      return nr
    })
    onChange({ cols, rows })
    setSel({ ri, ci })
    setNewOptionText('')
    setSelectPopup(null)
  }

  const statsLine = useMemo(
    () => t('knowledge.table.status.rowsCols', { rows: table.rows.length, cols: table.cols.length }),
    [t, table.rows.length, table.cols.length],
  )

  const canUndo = useMemo(() => historyRef.current.canUndo(), [histTick, table])
  const canRedo = useMemo(() => historyRef.current.canRedo(), [histTick, table])

  /** 列重命名：Enter/Tab/blur 均提交（Excel 式），Esc 取消。 */
  const commitColRename = (ci: number) => {
    setRenamingCi(null)
    const name = renameText.trim()
    if (!name || name === table.cols[ci]?.name) return
    const cols = table.cols.map((c, i) => (i === ci ? { ...c, name } : c))
    onChange({ cols, rows: table.rows })
  }

  // ── 排序 / 筛选 / 统计 / 导出（PR-5 数据能力） ───────────────────────────
  const sortBy = (colId: string, dir: 'asc' | 'desc') => {
    if (sortRef.current?.col === colId && sortRef.current.dir === dir) return
    // 推入变更后状态（含目标排序），避免与上一快照（排序前）去重冲突。
    pushHistoryStep({ col: colId, dir })
    setSortState({ col: colId, dir })
    setColMenuCi(null)
  }

  const clearSort = () => {
    if (!sortRef.current) return
    pushHistoryStep(null)
    setSortState(null)
    setColMenuCi(null)
  }

  const opsForType = (type: TableColType): TableFilterOp[] => {    switch (type) {
      case 'number':
      case 'date':
        return ['equals', 'gt', 'lt', 'isNotEmpty']
      case 'checkbox':
        return ['equals', 'isNotEmpty']
      case 'select':
        return ['equals', 'isNotEmpty']
      default:
        return ['contains', 'equals', 'isNotEmpty']
    }
  }

  const OP_LABEL_KEYS = {
    contains: 'knowledge.table.filter.opContains',
    equals: 'knowledge.table.filter.opEquals',
    isNotEmpty: 'knowledge.table.filter.opNotEmpty',
    gt: 'knowledge.table.filter.opGt',
    lt: 'knowledge.table.filter.opLt',
  } as const satisfies Record<TableFilterOp, string>

  /** 可见行 = 排序后的原始行索引，再叠加筛选（AND）。 */
  const visibleIndices = useMemo(() => {
    let order: number[] = table.rows.map((_, i) => i)
    if (sortState) {
      order = sortRowIndices({ cols: table.cols, rows: table.rows }, sortState.col, sortState.dir)
    }
    if (filters.length > 0) {
      order = order.filter((ri) => matchesAllFilters(table.rows[ri] ?? [], filters, table.cols))
    }
    return order
  }, [table, sortState, filters])

  const visibleData = useMemo(
    () => visibleIndices.map((ri) => table.rows[ri] ?? []),
    [visibleIndices, table],
  )

  const statsModeFor = (ci: number): 'sum' | 'avg' | 'count' | 'off' =>
    colStats[ci] ?? (table.cols[ci]?.type === 'number' ? 'sum' : 'count')

  const statsCell = (ci: number): string => {
    const mode = statsModeFor(ci)
    if (mode === 'off') return ''
    if (mode === 'count') return String(countNonEmpty(visibleData, ci))
    const v = mode === 'sum' ? sumRows(visibleData, ci) : avgRows(visibleData, ci)
    return Number.isInteger(v) ? String(v) : v.toFixed(1)
  }

  const exportCsv = async () => {
    const title =
      useKnowledgeStore.getState().nodes.find((n) => n.id === tableId)?.title ??
      t('knowledge.table.untitled')
    const dest = await pickSavePath({
      defaultPath: `${title}.csv`,
      title: t('knowledge.table.toolbar.exportCsv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (!dest) return
    try {
      // BOM 供 Excel 识别 UTF-8。导出全量数据（不随筛选）。
      await knowledgeExportText(dest, `\uFEFF${tableToCsv(tableRef.current)}`)
      toast.success(t('knowledge.export.docDone'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const backToBrowse = () => {
    void useKnowledgeStore.getState().backToBrowse()
  }

  // ── 列宽拖拽 + 双击自适应 ────────────────────────────────────────────
  const resizeRef = useRef<{ ci: number; startX: number; startW: number } | null>(null)
  const onResizeDown = (e: React.PointerEvent, ci: number) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = tableRef.current.cols[ci]?.width ?? 150
    resizeRef.current = { ci, startX, startW }
    const onMove = (ev: PointerEvent) => {
      const r = resizeRef.current
      if (!r) return
      const t = tableRef.current
      const cols = t.cols.map((c, i) =>
        i === r.ci ? { ...c, width: clampWidth(r.startW + (ev.clientX - r.startX)) } : c,
      )
      onChange({ cols, rows: t.rows }, { history: false })
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      // 拖拽全程为 live 态；结束时补推一步，撤销可恢复原宽。
      pushHistoryStep()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onResizeDbl = (ci: number) => {
    const t = tableRef.current
    const maxLen = Math.max(
      ...t.rows.map((r) => (r[ci] ?? '').length),
      colName(ci).length,
      1,
    )
    const cols = t.cols.map((c, i) =>
      i === ci ? { ...c, width: clampWidth(Math.max(64, maxLen * 8 + 28)) } : c,
    )
    onChange({ cols, rows: t.rows })
  }

  // ── 列拖拽重排 ───────────────────────────────────────────────────────
  const colDragRef = useRef<{
    ci: number
    startX: number
    overCi: number
    after: boolean
  } | null>(null)
  const [colDrag, setColDrag] = useState<{ ci: number; overCi: number; after: boolean } | null>(null)
  const onColDragDown = (e: React.PointerEvent, ci: number) => {
    e.preventDefault()
    e.stopPropagation()
    colDragRef.current = { ci, startX: e.clientX, overCi: ci, after: false }
    setColDrag({ ci, overCi: ci, after: false })
    const onMove = (ev: PointerEvent) => {
      const d = colDragRef.current
      if (!d) return
      const wrap = wrapRef.current
      if (!wrap) return
      const ths = [...wrap.querySelectorAll<HTMLElement>('thead th[data-col]')]
      let overCi = d.ci
      let after = false
      for (const th of ths) {
        const r = th.getBoundingClientRect()
        const ci = Number(th.dataset.col)
        if (ci === d.ci) continue
        if (ev.clientX >= r.left && ev.clientX <= r.right) {
          overCi = ci
          after = ev.clientX > r.left + r.width / 2
          break
        }
      }
      if (overCi !== d.overCi || after !== d.after) {
        d.overCi = overCi
        d.after = after
        setColDrag({ ci: d.ci, overCi, after })
      }
    }
    const onUp = () => {
      const d = colDragRef.current
      colDragRef.current = null
      setColDrag(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!d) return
      const from = d.ci
      let to = d.overCi
      if (to === from) return
      if (d.after && to > from) to += 1
      else if (!d.after && to < from) to += 1
      const t = tableRef.current
      const cols = [...t.cols]
      const [moved] = cols.splice(from, 1)
      cols.splice(to - (from < to ? 1 : 0), 0, moved)
      const rows = t.rows.map((r) => {
        const nr = [...r]
        const [v] = nr.splice(from, 1)
        nr.splice(to - (from < to ? 1 : 0), 0, v)
        return nr
      })
      onChange({ cols, rows })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ── 行拖拽移动 ───────────────────────────────────────────────────────
  const rowDragRef = useRef<{ ri: number; overRi: number; after: boolean } | null>(null)
  const [rowDrag, setRowDrag] = useState<{ ri: number; overRi: number; after: boolean } | null>(null)
  const onRowDragDown = (e: React.PointerEvent, ri: number) => {
    e.preventDefault()
    e.stopPropagation()
    rowDragRef.current = { ri, overRi: ri, after: false }
    setRowDrag({ ri, overRi: ri, after: false })
    const onMove = (ev: PointerEvent) => {
      const d = rowDragRef.current
      if (!d) return
      const wrap = wrapRef.current
      if (!wrap) return
      const trs = [...wrap.querySelectorAll<HTMLElement>('tbody tr[data-row]')]
      let overRi = d.ri
      let after = false
      for (const tr of trs) {
        const r = tr.getBoundingClientRect()
        const ri2 = Number(tr.dataset.row)
        if (ri2 === d.ri) continue
        if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
          overRi = ri2
          after = ev.clientY > r.top + r.height / 2
          break
        }
      }
      if (overRi !== d.overRi || after !== d.after) {
        d.overRi = overRi
        d.after = after
        setRowDrag({ ri: d.ri, overRi, after })
      }
    }
    const onUp = () => {
      const d = rowDragRef.current
      rowDragRef.current = null
      setRowDrag(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!d) return
      const from = d.ri
      const to = d.overRi
      if (to === from) return
      let insertAt = to
      if (d.after && to > from) insertAt += 1
      else if (!d.after && to < from) insertAt += 1
      const t = tableRef.current
      const rows = t.rows.map((r) => [...r])
      const [moved] = rows.splice(from, 1)
      rows.splice(insertAt - (from < to ? 1 : 0), 0, moved)
      onChange({ cols: t.cols, rows })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const wrapRef = useRef<HTMLDivElement>(null)

  const cellClass =
    'min-w-0 truncate border-b border-r border-border px-2 py-1.5 text-body text-ink focus:outline-none'

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-surface-content"
      data-testid="knowledge-table-editor"
      onClick={() => {
        if (colMenuCi != null || rowMenuRi != null || selectPopup != null) {
          setColMenuCi(null)
          setRowMenuRi(null)
          setSelectPopup(null)
        }
      }}
    >
      {/* 标题栏 */}
      <div
        className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4"
        data-testid="table-editor-header"
      >
        <button
          type="button"
          data-testid="table-editor-back"
          onClick={backToBrowse}
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-meta text-ink-secondary transition-colors hover:bg-state-hover hover:text-ink"
        >
          <Table2 size={14} aria-hidden />
          {t('knowledge.home.mySpaces')}
        </button>
        <span className="h-4 w-px bg-border" aria-hidden />
        <h1
          className="min-w-0 flex-1 truncate text-body font-semibold text-ink"
          data-testid="table-editor-title"
          onDoubleClick={() => {
            setTitleDraft(tableTitle)
            setTitleEditing(true)
          }}
          title={t('knowledge.tree.rename')}
        >
          {titleEditing ? (
            <input
              autoFocus
              data-testid="table-title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  const next = titleDraft.trim()
                  if (next) {
                    void useKnowledgeStore.getState().renameNode(tableId, next)
                  }
                  setTitleEditing(false)
                } else if (e.key === 'Escape') {
                  setTitleEditing(false)
                }
              }}
              onBlur={() => setTitleEditing(false)}
              onClick={(e) => e.stopPropagation()}
              className="min-w-0 w-full rounded-sm border border-accent/50 bg-surface px-1.5 py-0.5 text-body font-semibold text-ink outline-none"
            />
          ) : (
            tableTitle
          )}
        </h1>
        {/* 工具栏（撤销/重做/冻结首行；排序/筛选/统计/导出在 PR-5 激活） */}
        <div className="flex items-center gap-1" data-testid="table-editor-toolbar">
          <button
            type="button"
            data-testid="table-undo"
            disabled={!canUndo}
            onClick={undo}
            title={t('knowledge.table.toolbar.undo')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-state-hover hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            <Undo2 size={14} aria-hidden />
          </button>
          <button
            type="button"
            data-testid="table-redo"
            disabled={!canRedo}
            onClick={redo}
            title={t('knowledge.table.toolbar.redo')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-state-hover hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            <Redo2 size={14} aria-hidden />
          </button>
          <button
            type="button"
            data-testid="table-freeze"
            aria-pressed={freezeHeader}
            onClick={() => setFreezeHeader((v) => !v)}
            title={t('knowledge.table.toolbar.freezeHeader')}
            className={cn(
              'flex h-6 items-center gap-1 rounded-md px-1.5 text-meta transition-colors',
              freezeHeader
                ? 'bg-state-hover font-medium text-ink'
                : 'text-ink-tertiary hover:bg-state-hover hover:text-ink',
            )}
          >
            <Snowflake size={13} aria-hidden />
          </button>
          {/* 排序状态芯片：点击清除排序 */}
          {sortState ? (
            <button
              type="button"
              data-testid="table-sort-chip"
              onClick={clearSort}
              title={t('knowledge.table.columnMenu.sortClear')}
              className="flex h-6 items-center gap-1 rounded-md bg-state-hover px-1.5 text-meta font-medium text-ink transition-colors hover:bg-state-hover"
            >
              <ArrowUpDown size={12} aria-hidden />
              {colName(table.cols.findIndex((c) => c.id === sortState.col))} {sortState.dir === 'asc' ? '↑' : '↓'}
            </button>
          ) : null}
          <button
            type="button"
            data-testid="table-filter"
            aria-pressed={filterOpen}
            onClick={() => setFilterOpen((v) => !v)}
            title={t('knowledge.table.toolbar.filter')}
            className={cn(
              'relative flex h-6 items-center gap-1 rounded-md px-1.5 text-meta transition-colors',
              filterOpen || filters.length > 0
                ? 'bg-state-hover font-medium text-ink'
                : 'text-ink-tertiary hover:bg-state-hover hover:text-ink',
            )}
          >
            <Filter size={13} aria-hidden />
            {filters.length > 0 ? (
              <span
                className="flex h-4 min-w-4 items-center justify-center rounded-full bg-btn-primary px-1 text-[10px] font-semibold text-on-btn-primary"
                data-testid="table-filter-badge"
              >
                {filters.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            data-testid="table-stats"
            aria-pressed={statsOn}
            onClick={() => setStatsOn((v) => !v)}
            title={t('knowledge.table.toolbar.stats')}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
              statsOn
                ? 'bg-state-hover font-medium text-ink'
                : 'text-ink-tertiary hover:bg-state-hover hover:text-ink',
            )}
          >
            <Sigma size={14} aria-hidden />
          </button>
          <button
            type="button"
            data-testid="table-export"
            onClick={() => void exportCsv()}
            title={t('knowledge.table.toolbar.exportCsv')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink"
          >
            <FileDown size={14} aria-hidden />
          </button>
          <span className="rounded-md bg-surface-muted px-2 py-0.5 text-meta text-ink-tertiary">
            {statsLine}
          </span>
        </div>
      </div>

      {/* 筛选面板 */}
      {filterOpen ? (
        <div
          className="relative z-30 shrink-0 border-b border-border bg-surface px-4 py-2.5 shadow-overlay"
          data-testid="table-filter-panel"
        >
          <div className="flex flex-col gap-1.5">
            {filters.length === 0 ? (
              <p className="text-meta text-ink-tertiary">{t('knowledge.table.filter.title')}</p>
            ) : null}
            {filters.map((f, fi) => {
              const colType = table.cols[f.colIndex]?.type ?? 'text'
              return (
                <div key={fi} className="flex items-center gap-1.5" data-testid="table-filter-row">
                  <select
                    data-testid={`table-filter-col-${fi}`}
                    value={f.colIndex}
                    onChange={(e) => {
                      const colIndex = Number(e.target.value)
                      const next = [...filters]
                      next[fi] = { colIndex, op: 'contains', value: '' }
                      setFilters(next)
                    }}
                    className="h-7 rounded-md border border-border bg-surface px-1.5 text-caption text-ink outline-none focus:border-accent/50"
                  >
                    {table.cols.map((c, ci) => (
                      <option key={c.id} value={ci}>
                        {colName(ci)}
                      </option>
                    ))}
                  </select>
                  <select
                    data-testid={`table-filter-op-${fi}`}
                    value={f.op}
                    onChange={(e) => {
                      const next = [...filters]
                      next[fi] = { ...f, op: e.target.value as TableFilterOp }
                      setFilters(next)
                    }}
                    className="h-7 rounded-md border border-border bg-surface px-1.5 text-caption text-ink outline-none focus:border-accent/50"
                  >
                    {opsForType(colType).map((op) => (
                      <option key={op} value={op}>
                        {t(OP_LABEL_KEYS[op])}
                      </option>
                    ))}
                  </select>
                  {f.op !== 'isNotEmpty' ? (
                    <input
                      data-testid={`table-filter-value-${fi}`}
                      value={f.value}
                      placeholder={t('knowledge.table.filter.value')}
                      onChange={(e) => {
                        const next = [...filters]
                        next[fi] = { ...f, value: e.target.value }
                        setFilters(next)
                      }}
                      className="h-7 w-36 rounded-md border border-border bg-surface px-2 text-caption text-ink outline-none placeholder:text-ink-tertiary focus:border-accent/50"
                    />
                  ) : null}
                  <button
                    type="button"
                    data-testid={`table-filter-remove-${fi}`}
                    onClick={() => setFilters(filters.filter((_, i) => i !== fi))}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </div>
              )
            })}
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="table-filter-add"
                onClick={() => setFilters([...filters, { colIndex: 0, op: 'contains', value: '' }])}
                className="rounded-md px-2 py-1 text-caption font-medium text-accent-strong transition-colors hover:bg-state-hover"
              >
                + {t('knowledge.table.filter.addCondition')}
              </button>
              {filters.length > 0 ? (
                <button
                  type="button"
                  data-testid="table-filter-clear"
                  onClick={() => setFilters([])}
                  className="rounded-md px-2 py-1 text-caption text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink"
                >
                  {t('knowledge.table.filter.clear')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* 网格 */}
      <div
        className="min-h-0 flex-1 overflow-auto"
        data-testid="table-grid-wrap"
        ref={wrapRef}
      >
        <table
          className="grid-table w-max border-collapse select-none"
          data-testid="table-grid"
          data-cols={table.cols.length}
          data-rows={table.rows.length}
          tabIndex={0}
          onKeyDown={handleGridKeyDown}
        >
          <thead>
            <tr>
              {/* 行号角格 */}
              <th
                className="sticky left-0 top-0 z-20 h-9 w-10 border-b border-r border-border bg-surface-muted"
                data-testid="table-corner"
              >
                <Plus
                  size={13}
                  className="mx-auto cursor-pointer text-ink-tertiary transition-colors hover:text-ink"
                  aria-label={t('knowledge.table.grid.addColumn')}
                  data-testid="table-add-col"
                  onClick={() => insertColumn(table.cols.length - 1, 1)}
                />
              </th>
              {table.cols.map((col, ci) => (
                <th
                  key={col.id}
                  data-col={ci}
                  data-col-id={col.id}
                  data-col-type={col.type}
                  style={{ width: col.width, minWidth: col.width }}
                  className={cn(
                    'sticky top-0 z-10 h-9 cursor-pointer border-b border-r border-border bg-surface-muted px-2 text-left text-caption font-medium text-ink',
                    !freezeHeader && 'relative',
                    sortRef.current?.col === col.id && 'bg-state-hover',
                    colDrag?.ci === ci && 'opacity-40',
                    colDrag && colDrag.ci !== ci && colDrag.overCi === ci && 'bg-state-hover',
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    setColMenuCi(colMenuCi === ci ? null : ci)
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span
                      className="shrink-0 cursor-grab text-ink-tertiary/50 transition-colors hover:text-ink"
                      data-testid={`table-col-grip-${ci}`}
                      title={t('knowledge.table.columnMenu.insertLeft')}
                      onPointerDown={(e) => onColDragDown(e, ci)}
                    >
                      <ArrowUpDown size={11} aria-hidden />
                    </span>
                    <span className="shrink-0 text-ink-tertiary">
                      {(() => {
                        const Icon = TYPE_ICONS[col.type]
                        return <Icon size={12} aria-hidden />
                      })()}
                    </span>
                    {renamingCi === ci ? (
                      <input
                        autoFocus
                        data-testid="table-col-rename-input"
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault()
                            commitColRename(ci)
                          } else if (e.key === 'Escape') {
                            setRenamingCi(null)
                          }
                        }}
                        onBlur={() => commitColRename(ci)}
                        className="min-w-0 flex-1 rounded-sm border border-accent/50 bg-surface px-1 py-0.5 text-caption text-ink outline-none"
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{colName(ci)}</span>
                    )}
                    {sortRef.current?.col === col.id ? (
                      <span className="shrink-0 text-ink-secondary" data-testid="table-col-sort-ind">
                        {sortRef.current.dir === 'asc' ? '↑' : '↓'}
                      </span>
                    ) : null}
                  </div>
                  {/* 列宽拖拽手柄（右缘）+ 双击自适应 */}
                  <span
                    data-testid={`table-col-resize-${ci}`}
                    className="absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize transition-colors hover:bg-accent/40"
                    onPointerDown={(e) => onResizeDown(e, ci)}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      onResizeDbl(ci)
                    }}
                  />
                  {colMenuCi === ci ? (
                    <div
                      className="absolute left-0 top-full z-30 w-44 rounded-lg border border-border bg-surface py-1 shadow-overlay"
                      data-testid="table-col-menu"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        data-testid="table-col-rename"
                        onClick={() => {
                          setRenameText(col.name)
                          setRenamingCi(ci)
                          setColMenuCi(null)
                        }}
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body text-ink transition-colors hover:bg-state-hover"
                      >
                        {t('knowledge.table.columnMenu.rename')}
                      </button>
                      <div className="my-1 border-t border-border" />
                      <div className="px-2.5 pb-1 pt-0.5 text-meta text-ink-tertiary">
                        {t('knowledge.table.columnMenu.type')}
                      </div>
                      {COL_TYPE_ORDER.map((ty) => (
                        <button
                          key={ty}
                          type="button"
                          data-testid={`table-col-type-${ty}`}
                          onClick={() => setColType(ci, ty)}
                          className={cn(
                            'flex w-full items-center gap-2 px-2.5 py-1 text-left text-body transition-colors hover:bg-state-hover',
                            col.type === ty ? 'font-medium text-ink' : 'text-ink-secondary',
                          )}
                        >
                          <span className="w-3.5 shrink-0 text-ink-tertiary">
                            {(() => {
                              const Icon = TYPE_ICONS[ty]
                              return <Icon size={12} aria-hidden />
                            })()}
                          </span>
                          {t(`knowledge.table.types.${ty}`)}
                        </button>
                      ))}
                      <div className="my-1 border-t border-border" />
                      <button
                        type="button"
                        data-testid="table-col-insert-left"
                        onClick={() => insertColumn(ci, 0)}
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body text-ink transition-colors hover:bg-state-hover"
                      >
                        {t('knowledge.table.columnMenu.insertLeft')}
                      </button>
                      <button
                        type="button"
                        data-testid="table-col-insert-right"
                        onClick={() => insertColumn(ci, 1)}
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body text-ink transition-colors hover:bg-state-hover"
                      >
                        {t('knowledge.table.columnMenu.insertRight')}
                      </button>
                      <div className="my-1 border-t border-border" />
                      <button
                        type="button"
                        data-testid="table-col-sort-asc"
                        onClick={() => sortBy(col.id, 'asc')}
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body text-ink transition-colors hover:bg-state-hover"
                      >
                        ↑ {t('knowledge.table.columnMenu.sortAsc')}
                      </button>
                      <button
                        type="button"
                        data-testid="table-col-sort-desc"
                        onClick={() => sortBy(col.id, 'desc')}
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body text-ink transition-colors hover:bg-state-hover"
                      >
                        ↓ {t('knowledge.table.columnMenu.sortDesc')}
                      </button>
                      {sortRef.current?.col === col.id ? (
                        <button
                          type="button"
                          data-testid="table-col-sort-clear"
                          onClick={clearSort}
                          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body text-ink-secondary transition-colors hover:bg-state-hover"
                        >
                          {t('knowledge.table.columnMenu.sortClear')}
                        </button>
                      ) : null}
                      {statsOn ? (
                        <>
                          <div className="my-1 border-t border-border" />
                          <div className="px-2.5 pb-1 pt-0.5 text-meta text-ink-tertiary">
                            {t('knowledge.table.columnMenu.statsShow')}
                          </div>
                          {col.type === 'number' ? (
                            <>
                              <button
                                type="button"
                                data-testid="table-col-stats-sum"
                                onClick={() => {
                                  setColStats((s) => ({ ...s, [ci]: 'sum' }))
                                  setColMenuCi(null)
                                }}
                                className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-body text-ink transition-colors hover:bg-state-hover"
                              >
                                {t('knowledge.table.columnMenu.statsSum')}
                              </button>
                              <button
                                type="button"
                                data-testid="table-col-stats-avg"
                                onClick={() => {
                                  setColStats((s) => ({ ...s, [ci]: 'avg' }))
                                  setColMenuCi(null)
                                }}
                                className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-body text-ink transition-colors hover:bg-state-hover"
                              >
                                {t('knowledge.table.columnMenu.statsAvg')}
                              </button>
                            </>
                          ) : null}
                          <button
                            type="button"
                            data-testid="table-col-stats-count"
                            onClick={() => {
                              setColStats((s) => ({ ...s, [ci]: 'count' }))
                              setColMenuCi(null)
                            }}
                            className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-body text-ink transition-colors hover:bg-state-hover"
                          >
                            {t('knowledge.table.columnMenu.statsCount')}
                          </button>
                          <button
                            type="button"
                            data-testid="table-col-stats-off"
                            onClick={() => {
                              setColStats((s) => ({ ...s, [ci]: 'off' }))
                              setColMenuCi(null)
                            }}
                            className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-body text-ink-secondary transition-colors hover:bg-state-hover"
                          >
                            {t('knowledge.table.columnMenu.statsOff')}
                          </button>
                        </>
                      ) : null}
                      <div className="my-1 border-t border-border" />
                      <button
                        type="button"
                        data-testid="table-col-delete"
                        onClick={() => deleteColumn(ci)}
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body text-danger transition-colors hover:bg-danger/10"
                      >
                        {t('knowledge.table.columnMenu.deleteColumn')}
                      </button>
                    </div>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleIndices.map((ri) => {
              const row = table.rows[ri] ?? []
              return (
              <tr key={ri} data-row={ri}>
                <td
                  className={cn(
                    'sticky left-0 z-10 border-b border-r border-border bg-surface-muted text-center text-meta text-ink-tertiary',
                    rowDrag?.ri === ri && 'opacity-40',
                    rowDrag && rowDrag.ri !== ri && rowDrag.overRi === ri && 'bg-state-hover',
                  )}
                  data-testid="table-row-idx"
                >
                  <div className="relative flex h-full items-center justify-center gap-1 py-1.5">
                    <span
                      className="cursor-grab text-ink-tertiary/50 transition-colors hover:text-ink"
                      data-testid={`table-row-grip-${ri}`}
                      title={t('knowledge.table.rowMenu.insertAbove')}
                      onPointerDown={(e) => onRowDragDown(e, ri)}
                    >
                      <MoreHorizontal size={12} aria-hidden />
                    </span>
                    <span>{ri + 1}</span>
                    <span
                      className="group relative"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRowMenuRi(rowMenuRi === ri ? null : ri)
                      }}
                    >
                      <MoreHorizontal
                        size={13}
                        className="cursor-pointer text-ink-tertiary/70 transition-colors hover:text-ink"
                        data-testid={`table-row-menu-${ri}`}
                      />
                      {rowMenuRi === ri ? (
                        <div
                          className="absolute left-6 top-0 z-30 w-40 rounded-lg border border-border bg-surface py-1 shadow-overlay"
                          data-testid="table-row-menu"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              addRow(ri)
                              setRowMenuRi(null)
                            }}
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body text-ink transition-colors hover:bg-state-hover"
                          >
                            {t('knowledge.table.rowMenu.insertAbove')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              addRow(ri + 1)
                              setRowMenuRi(null)
                            }}
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body text-ink transition-colors hover:bg-state-hover"
                          >
                            {t('knowledge.table.rowMenu.insertBelow')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              duplicateRow(ri)
                              setRowMenuRi(null)
                            }}
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body text-ink transition-colors hover:bg-state-hover"
                          >
                            {t('knowledge.table.rowMenu.duplicate')}
                          </button>
                          <div className="my-1 border-t border-border" />
                          <button
                            type="button"
                            onClick={() => deleteRow(ri)}
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body text-danger transition-colors hover:bg-danger/10"
                          >
                            {t('knowledge.table.rowMenu.deleteRow')}
                          </button>
                        </div>
                      ) : null}
                    </span>
                  </div>
                </td>
                {table.cols.map((col, ci) => {
                  const value = row[ci] ?? ''
                  const isSel = sel.ri === ri && sel.ci === ci
                  const isEditing = editing?.ri === ri && editing?.ci === ci
                  const cellContent = (() => {
                    if (isEditing) {
                      return (
                        <input
                          autoFocus
                          data-testid="table-cell-input"
                          value={editing.value}
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') {
                              if (e.shiftKey) {
                                setEditing({ ...editing, value: editing.value + '\n' })
                              } else {
                                commitEdit()
                              }
                            } else if (e.key === 'Tab') {
                              commitEdit()
                              setSel({ ri, ci: ci + 1 })
                            } else if (e.key === 'Escape') {
                              setEditing(null)
                            }
                          }}
                          onBlur={() => commitEdit()}
                          className="h-full w-full min-w-0 rounded-sm border border-accent bg-surface px-1 text-body text-ink outline-none"
                        />
                      )
                    }
                    switch (col.type) {
                      case 'checkbox':
                        return (
                          <span
                            className={cn(
                              'flex h-4 w-4 cursor-pointer items-center justify-center rounded-[4px] border text-[10px] leading-none text-on-btn-primary transition-colors',
                              value === '1'
                                ? 'border-[var(--border-strong)] bg-btn-primary'
                                : 'border-[var(--border-strong)] bg-surface hover:bg-state-hover',
                            )}
                            data-testid={`table-check-${ri}-${ci}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleCheck(ri, ci)
                            }}
                          >
                            {value === '1' ? '✓' : ''}
                          </span>
                        )
                      case 'select':
                        return (
                          <span className="relative flex items-center gap-1">
                            <span className="min-w-0 flex-1 truncate">
                              {value || <span className="text-ink-tertiary/60">—</span>}
                            </span>
                            <ChevronDown size={11} className="shrink-0 text-ink-tertiary" />
                            {selectPopup?.ri === ri && selectPopup?.ci === ci ? (
                              <span
                                className="absolute left-0 top-full z-30 w-44 rounded-lg border border-border bg-surface py-1 shadow-overlay"
                                data-testid="table-select-popup"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {(col.options ?? []).map((opt, oi) => (
                                  <button
                                    key={opt}
                                    type="button"
                                    data-testid={`table-select-opt-${ri}-${ci}-${oi}`}
                                    onClick={() => selectOption(ri, ci, opt)}
                                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body text-ink transition-colors hover:bg-state-hover"
                                  >
                                    {opt}
                                  </button>
                                ))}
                                <div className="flex items-center gap-1.5 border-t border-border px-2 py-1.5">
                                  <input
                                    autoFocus
                                    data-testid="table-select-new-input"
                                    value={newOptionText}
                                    placeholder={t('knowledge.table.types.selectNewOption')}
                                    onChange={(e) => setNewOptionText(e.target.value)}
                                    onKeyDown={(e) => {
                                      e.stopPropagation()
                                      if (e.key === 'Enter') addSelectOption(ri, ci)
                                      if (e.key === 'Escape') setSelectPopup(null)
                                    }}
                                    className="min-w-0 flex-1 rounded-sm border border-border bg-surface px-1.5 py-0.5 text-caption text-ink outline-none placeholder:text-ink-tertiary"
                                  />
                                </div>
                              </span>
                            ) : null}
                          </span>
                        )
                      default:
                        return (
                          <span className="block min-w-0 truncate" data-testid={`table-cell-${ri}-${ci}`}>
                            {value || (table.rows.length === 1 && table.cols.length === 1 && ri === 0 && ci === 0 ? (
                              <span className="text-ink-tertiary/60">
                                {t('knowledge.table.grid.firstCellHint')}
                              </span>
                            ) : null)}
                          </span>
                        )
                    }
                  })()
                  return (
                    <td
                      key={col.id}
                      data-cell={`${ri},${ci}`}
                      data-type={col.type}
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (col.type === 'checkbox') return
                        if (col.type === 'select') {
                          setSelectPopup(selectPopup?.ri === ri && selectPopup?.ci === ci ? null : { ri, ci })
                          return
                        }
                        setSel({ ri, ci })
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        if (col.type === 'checkbox' || col.type === 'select') return
                        setEditing({ ri, ci, value })
                      }}
                      className={cn(
                        cellClass,
                        col.type === 'number' && 'text-right tabular-nums',
                        isSel &&
                          'relative bg-state-hover outline outline-1 outline-[var(--accent-strong)]',
                      )}
                      style={{ width: col.width }}
                    >
                      {cellContent}
                    </td>
                  )
                })}
              </tr>
              )
            })}
            {/* 统计行（Σ；仅统计可见行；不参与数据） */}
            {statsOn ? (
              <tr data-testid="table-stats-row">
                <td className="sticky left-0 z-10 border-b border-r border-border bg-surface-muted text-center text-meta font-semibold text-ink-secondary">
                  <Sigma size={12} className="mx-auto" aria-hidden />
                </td>
                {table.cols.map((col, ci) => (
                  <td
                    key={col.id}
                    data-stats-cell={ci}
                    className="border-b border-r border-border bg-surface-muted px-2 py-1.5 text-caption font-medium tabular-nums text-ink-secondary"
                  >
                    {statsCell(ci) || ''}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* 底部状态栏 */}
      <div
        className="flex h-7 shrink-0 items-center gap-2 border-t border-border px-4 text-meta"
        data-testid="table-editor-status"
      >
        <span className="text-ink-tertiary">{statsLine}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              tableSaveState === 'error' ? 'bg-danger' : 'bg-warning animate-pulse',
            )}
            aria-hidden
          />
          {tableSaveState === 'error' ? (
            <button
              type="button"
              data-testid="table-save-retry"
              onClick={() => void commitTable(tableId)}
              className="rounded-sm px-1 text-meta font-medium text-accent-strong hover:underline"
            >
              {t('knowledge.table.status.saving')} · {t('knowledge.doc.saveRetry')}
            </button>
          ) : tableSaveState === 'saving' ? (
            <span className="text-ink-tertiary">{t('knowledge.table.status.saving')}</span>
          ) : (
            <span className="text-ink-tertiary/70">{t('knowledge.table.status.saved')}</span>
          )}
        </span>
      </div>
    </div>
  )
}
