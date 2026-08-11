/**
 * 轻表格纯函数库（knowledge-table PR-1）。
 *
 * 无 DOM / i18n 依赖，可在 node 与浏览器中直接运行（vitest / Rust 侧不做）。
 * 数据模型：
 * - `TableData.cols`：列定义（id/name/type/width/options），持久化在 `tbl_*.meta.json`
 * - `TableData.rows`：`rows[ri][ci]` 单元格字符串（CSV 原生语义），持久化在 `tbl_*.csv`
 * - 列类型：text / number / checkbox / date / select
 *
 * 覆盖：CSV round-trip（RFC 4180）、meta 合并与缺失回退、类型感知排序比较器、
 * 筛选条件求值、统计聚合（可见行）、撤销栈（含排序状态，上限 50）。
 */

export type TableColType = 'text' | 'number' | 'checkbox' | 'date' | 'select'

export interface TableColumn {
  id: string
  name: string
  type: TableColType
  width: number
  /** select 列的候选选项（去重保序）。 */
  options?: string[]
}

export interface TableData {
  cols: TableColumn[]
  rows: string[][]
}

export interface TableSortState {
  col: string
  dir: 'asc' | 'desc'
}

/** 撤销栈快照：数据 + 排序状态（筛选为视图态，不入栈）。 */
export interface TableSnapshot {
  table: TableData
  sort: TableSortState | null
}

export const TABLE_COL_TYPES: readonly TableColType[] = [
  'text',
  'number',
  'checkbox',
  'date',
  'select',
]

export const DEFAULT_COL_WIDTH = 150
export const MIN_COL_WIDTH = 48
export const MAX_COL_WIDTH = 600

export function normalizeColType(v: unknown): TableColType {
  return TABLE_COL_TYPES.includes(v as TableColType) ? (v as TableColType) : 'text'
}

export function clampWidth(w: number): number {
  if (!Number.isFinite(w)) return DEFAULT_COL_WIDTH
  return Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(w)))
}

/** 单元格合法化的列 id（`col_<n>` 前缀），避免与既有列冲突。 */
export function newColumnId(t: TableData): string {
  let max = 0
  for (const c of t.cols) {
    const m = /^col_(\d+)$/.exec(c.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `col_${max + 1}`
}

export function createColumn(type: TableColType, t: TableData, opts?: Partial<TableColumn>): TableColumn {
  return {
    id: newColumnId(t),
    name: '',
    type,
    width: DEFAULT_COL_WIDTH,
    ...opts,
  }
}

/** 默认空表（新建表格）：3 列 × 3 行，全部 text，未命名（UI 渲染列号兜底）。 */
export function createEmptyTable(rowCount = 3, colCount = 3): TableData {
  const cols: TableColumn[] = Array.from({ length: colCount }, (_, i) => ({
    id: `col_${i + 1}`,
    name: '',
    type: 'text',
    width: DEFAULT_COL_WIDTH,
  }))
  const rows: string[][] = Array.from({ length: rowCount }, () =>
    Array<string>(colCount).fill(''),
  )
  return { cols, rows }
}

export function cloneTable(t: TableData): TableData {
  return {
    cols: t.cols.map((c) => ({ ...c, options: c.options ? [...c.options] : undefined })),
    rows: t.rows.map((r) => [...r]),
  }
}

export function isEqualTable(a: TableData, b: TableData): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ── CSV（RFC 4180） ────────────────────────────────────────────────────────

/**
 * 解析 CSV 文本。支持：引号包裹字段、`""` 转义、内嵌逗号/换行/CRLF、
 * BOM 剥离、末尾无换行的最后一行。结尾多余空行被丢弃。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1
  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }
  while (i < n) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      endField()
      i++
      continue
    }
    if (c === '\n') {
      endRow()
      i++
      continue
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') i++
      endRow()
      i++
      continue
    }
    field += c
    i++
  }
  if (field !== '' || row.length > 0) endRow()
  // 文件以换行结尾时产生的末尾空行不视为数据行。
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop()
  }
  return rows
}

function escapeCell(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')) {
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}

/** 序列化为 CSV（LF 行尾；BOM 由导出层决定）。 */
export function serializeCsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeCell).join(',')).join('\n')
}

// ── meta 合并与缺失回退 ───────────────────────────────────────────────────

/**
 * 校验并规范化 meta.cols。任何字段缺失/非法时逐项回退：
 * 未知类型 → text；width 越界 → 150；name 非字符串 → ''。
 * 整体非法（非对象 / cols 非数组 / 空）→ null（调用方走行宽推导回退）。
 */
export function normalizeMeta(raw: unknown): TableColumn[] | null {
  let input: unknown = raw
  if (typeof raw === 'string') {
    try {
      input = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!input || typeof input !== 'object') return null
  const m = input as { cols?: unknown }
  if (!Array.isArray(m.cols)) return null
  const cols: TableColumn[] = []
  for (const c of m.cols) {
    if (!c || typeof c !== 'object') return null
    const o = c as Record<string, unknown>
    if (typeof o.id !== 'string' || o.id === '') return null
    const options = Array.isArray(o.options)
      ? [...new Set(o.options.filter((x): x is string => typeof x === 'string'))]
      : undefined
    cols.push({
      id: o.id,
      name: typeof o.name === 'string' ? o.name : '',
      type: normalizeColType(o.type),
      width: typeof o.width === 'number' ? clampWidth(o.width) : DEFAULT_COL_WIDTH,
      ...(options && options.length > 0 ? { options } : {}),
    })
  }
  if (cols.length === 0) return null
  return cols
}

/** meta 缺失时按数据宽度推导默认列（text，150px）。 */
export function fallbackColsForRows(rows: string[][]): TableColumn[] {
  const count = Math.max(1, ...rows.map((r) => r.length))
  return Array.from({ length: count }, (_, i) => ({
    id: `col_${i + 1}`,
    name: '',
    type: 'text' as const,
    width: DEFAULT_COL_WIDTH,
  }))
}

/** csv + meta → TableData；meta 缺失/非法时回退推导，保证不丢数据。 */
export function csvToTable(csvText: string, metaRaw: unknown): TableData {
  const rows = parseCsv(csvText)
  const cols = normalizeMeta(metaRaw) ?? fallbackColsForRows(rows)
  return { cols, rows }
}

export function tableToCsv(t: TableData): string {
  return serializeCsv(t.rows)
}

export function metaFromTable(t: TableData): { cols: TableColumn[] } {
  return {
    cols: t.cols.map((c) => ({ ...c, options: c.options ? [...c.options] : undefined })),
  }
}

// ── 排序（类型感知比较器） ─────────────────────────────────────────────────

function parseNum(v: string): number {
  const n = Number.parseFloat(v.replace(/[,¥$€£\s]/g, ''))
  return Number.isFinite(n) ? n : Number.NaN
}

/** 数值/日期比较：合法值按数值大小；非法值按文本序，且排在合法值之后。 */
function cmpNumeric(a: string, b: string): number {
  const na = parseNum(a)
  const nb = parseNum(b)
  const va = Number.isFinite(na)
  const vb = Number.isFinite(nb)
  if (va && vb) return na - nb
  if (va) return -1
  if (vb) return 1
  return a.localeCompare(b)
}

/** 单元格比较（升序语义；desc 由调用方反转并加稳定序）。 */
export function compareCells(a: string, b: string, type: TableColType): number {
  switch (type) {
    case 'number':
    case 'date':
      return cmpNumeric(a, b)
    case 'checkbox':
      return (a === '1' ? 1 : 0) - (b === '1' ? 1 : 0)
    case 'select':
    case 'text':
      return a.localeCompare(b, undefined, { sensitivity: 'base' })
  }
}

export function sortRows(t: TableData, colId: string, dir: 'asc' | 'desc'): TableData {
  return { cols: t.cols, rows: sortRowIndices(t, colId, dir).map((ri) => [...t.rows[ri]]) }
}

/** 返回排序后的原始行索引（稳定序；未知列返回原序）。 */
export function sortRowIndices(t: TableData, colId: string, dir: 'asc' | 'desc'): number[] {
  const ci = t.cols.findIndex((c) => c.id === colId)
  if (ci < 0) return t.rows.map((_, i) => i)
  const type = t.cols[ci].type
  const idx = t.rows.map((_, ri) => ri)
  idx.sort((x, y) => {
    const c = compareCells(t.rows[x][ci] ?? '', t.rows[y][ci] ?? '', type)
    if (c !== 0) return dir === 'asc' ? c : -c
    return x - y // 稳定序
  })
  return idx
}

// ── 筛选（条件求值；仅影响当前查看） ──────────────────────────────────────

export type TableFilterOp = 'contains' | 'equals' | 'isNotEmpty' | 'gt' | 'lt'

export interface TableFilter {
  colIndex: number
  op: TableFilterOp
  value: string
}

export function matchesFilter(row: string[], f: TableFilter, type: TableColType): boolean {
  const raw = row[f.colIndex] ?? ''
  const v = raw.trim()
  switch (f.op) {
    case 'isNotEmpty':
      return v !== ''
    case 'contains':
      return v.toLowerCase().includes(f.value.trim().toLowerCase())
    case 'equals':
      if (type === 'checkbox') {
        // 未勾选 = 空 或 '0'；勾选 = '1'
        return f.value === '1' ? v === '1' : v === '' || v === '0'
      }
      return v.toLowerCase() === f.value.trim().toLowerCase()
    case 'gt':
      return v !== '' && cmpNumeric(v, f.value) > 0
    case 'lt':
      return v !== '' && cmpNumeric(v, f.value) < 0
  }
}

export function applyFilters(t: TableData, filters: TableFilter[]): TableData {
  if (filters.length === 0) return t
  return {
    cols: t.cols,
    rows: t.rows.filter((row) => matchesAllFilters(row, filters, t.cols)),
  }
}

/** 多条件 AND 求值（可见行判断用，避免构造中间表）。 */
export function matchesAllFilters(
  row: string[],
  filters: TableFilter[],
  cols: TableColumn[],
): boolean {
  return filters.every((f) => matchesFilter(row, f, cols[f.colIndex]?.type ?? 'text'))
}

/** 视图行序 = 排序后的原始行索引，再叠加筛选（AND）。筛选为纯视图态。 */
export function viewIndexes(
  t: TableData,
  sort: TableSortState | null,
  filters: TableFilter[],
): number[] {
  let order: number[] = t.rows.map((_, i) => i)
  if (sort) {
    order = sortRowIndices(t, sort.col, sort.dir)
  }
  if (filters.length > 0) {
    order = order.filter((ri) => matchesAllFilters(t.rows[ri] ?? [], filters, t.cols))
  }
  return order
}

// ── 统计（仅可见行） ──────────────────────────────────────────────────────

export function countNonEmpty(rows: string[][], ci: number): number {
  let n = 0
  for (const r of rows) if ((r[ci] ?? '').trim() !== '') n++
  return n
}

export function sumRows(rows: string[][], ci: number): number {
  let sum = 0
  for (const r of rows) {
    const v = parseNum(r[ci] ?? '')
    if (Number.isFinite(v)) sum += v
  }
  return sum
}

export function avgRows(rows: string[][], ci: number): number {
  let sum = 0
  let n = 0
  for (const r of rows) {
    const v = parseNum(r[ci] ?? '')
    if (Number.isFinite(v)) {
      sum += v
      n++
    }
  }
  return n === 0 ? 0 : sum / n
}

// ── 统计模式（逐列；缺省：数字→求和，其余→计数） ──────────────────────────

export type ColStatsMode = 'sum' | 'avg' | 'count' | 'off'

export function defaultStatsMode(type: TableColType): ColStatsMode {
  return type === 'number' ? 'sum' : 'count'
}

/** 统计行单元格文本（仅可见行数据；off → ''）。 */
export function statsValue(rows: string[][], ci: number, mode: ColStatsMode): string {
  if (mode === 'off') return ''
  if (mode === 'count') return String(countNonEmpty(rows, ci))
  const v = mode === 'sum' ? sumRows(rows, ci) : avgRows(rows, ci)
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

// ── 选区（视图坐标；anchor/focus 矩形） ───────────────────────────────────

export interface CellPos {
  ri: number
  ci: number
}

export type SelectionMode = 'cell' | 'row' | 'column'

/**
 * 选区 = anchor/focus 矩形（视图坐标）。
 * mode 决定整行/整列语义：cell=普通矩形，row=全部列，column=全部行。
 */
export interface TableSelection {
  anchor: CellPos
  focus: CellPos
  mode: SelectionMode
}

export function clampSelection(sel: TableSelection, rows: number, cols: number): TableSelection {
  const clamp = (p: CellPos): CellPos => ({
    ri: Math.max(0, Math.min(rows - 1, p.ri)),
    ci: Math.max(0, Math.min(cols - 1, p.ci)),
  })
  return { anchor: clamp(sel.anchor), focus: clamp(sel.focus), mode: sel.mode }
}

/** 选区覆盖的视图行列范围（min/max，含端点）。 */
export function selectionSpan(
  sel: TableSelection,
): { r0: number; r1: number; c0: number; c1: number } {
  const a = sel.anchor
  const f = sel.focus
  return {
    r0: Math.min(a.ri, f.ri),
    r1: Math.max(a.ri, f.ri),
    c0: Math.min(a.ci, f.ci),
    c1: Math.max(a.ci, f.ci),
  }
}

/** 选区视图坐标展开（整行→全部列；整列→全部行）。 */
export function selectionCells(sel: TableSelection, rows: number, cols: number): CellPos[] {
  if (rows <= 0 || cols <= 0) return []
  const s = clampSelection(sel, rows, cols)
  let { r0, r1, c0, c1 } = selectionSpan(s)
  if (s.mode === 'row') {
    c0 = 0
    c1 = cols - 1
  }
  if (s.mode === 'column') {
    r0 = 0
    r1 = rows - 1
  }
  const out: CellPos[] = []
  for (let ri = r0; ri <= r1; ri++) {
    for (let ci = c0; ci <= c1; ci++) {
      out.push({ ri, ci })
    }
  }
  return out
}

/** 选区对应的数据坐标（视图坐标经 viewOrder 映射；排序/筛选后仍写对行）。 */
export function selectionDataCells(
  sel: TableSelection,
  viewOrder: number[],
  rows: number,
  cols: number,
): CellPos[] {
  return selectionCells(sel, rows, cols).map((p) => ({ ri: viewOrder[p.ri] ?? p.ri, ci: p.ci }))
}

/** Shift+方向键扩展（或锚定后移动）；越界钳制；mode 随当前选区不变。 */
export function expandSelection(
  sel: TableSelection,
  dr: number,
  dc: number,
  rows: number,
  cols: number,
): TableSelection {
  const next = {
    anchor: { ...sel.anchor },
    focus: { ri: sel.focus.ri + dr, ci: sel.focus.ci + dc },
    mode: sel.mode,
  }
  return clampSelection(next, rows, cols)
}

// ── 剪贴板（TSV；仅含 \t 视为表格） ───────────────────────────────────────

export const PASTE_LIMIT = { rows: 200, cols: 50 }

function escapeTsvCell(v: string): string {
  if (v.includes('\t') || v.includes('\n') || v.includes('"')) {
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}

/**
 * 解析剪贴板文本。含 `\t` → TSV 表格（引号包裹/`""` 转义）；否则返回 null
 * （视为单格多行文本，由调用方原样写入一个单元格）。
 */
export function parseClipboardText(text: string): string[][] | null {
  const t = text.replace(/^\uFEFF/, '')
  if (!t.includes('\t')) return null
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = t.length
  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }
  while (i < n) {
    const c = t[i]
    if (inQuotes) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === '\t') {
      endField()
      i++
      continue
    }
    if (c === '\n') {
      endRow()
      i++
      continue
    }
    if (c === '\r') {
      if (t[i + 1] === '\n') i++
      endRow()
      i++
      continue
    }
    field += c
    i++
  }
  if (field !== '' || row.length > 0) endRow()
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop()
  }
  return rows
}

/** 选区序列化为 TSV（按视图顺序取数据行）。 */
export function serializeClipboard(
  t: TableData,
  sel: TableSelection,
  viewOrder: number[],
): string {
  const { r0, r1, c0, c1 } = selectionSpan(sel)
  const lines: string[] = []
  for (let vi = r0; vi <= r1; vi++) {
    const row = t.rows[viewOrder[vi] ?? vi] ?? []
    lines.push(
      (sel.mode === 'row' ? row : row.slice(c0, c1 + 1)).map(escapeTsvCell).join('\t'),
    )
  }
  return lines.join('\n')
}

// ── 撤销栈（结构化快照，含排序状态，上限 50） ─────────────────────────────

export interface TableHistory {
  push(snap: TableSnapshot): void
  /** 回到上一步；无可撤销时返回 null。 */
  undo(): TableSnapshot | null
  redo(): TableSnapshot | null
  canUndo(): boolean
  canRedo(): boolean
  reset(snap: TableSnapshot): void
}

const cloneSnap = (s: TableSnapshot): TableSnapshot =>
  structuredClone({ table: s.table, sort: s.sort ? { ...s.sort } : null })

export function createTableHistory(cap = 50): TableHistory {
  let stack: TableSnapshot[] = []
  let cursor = -1

  const trim = () => {
    if (stack.length > cap) {
      stack = stack.slice(stack.length - cap)
      cursor = stack.length - 1
    }
  }

  return {
    push(snap) {
      const s = cloneSnap(snap)
      if (cursor >= 0 && JSON.stringify(stack[cursor]) === JSON.stringify(s)) return
      stack = stack.slice(0, cursor + 1)
      stack.push(s)
      cursor = stack.length - 1
      trim()
    },
    undo() {
      if (cursor <= 0) return null
      cursor--
      return cloneSnap(stack[cursor])
    },
    redo() {
      if (cursor >= stack.length - 1) return null
      cursor++
      return cloneSnap(stack[cursor])
    },
    canUndo() {
      return cursor > 0
    },
    canRedo() {
      return cursor < stack.length - 1
    },
    reset(snap) {
      stack = [cloneSnap(snap)]
      cursor = 0
    },
  }
}
