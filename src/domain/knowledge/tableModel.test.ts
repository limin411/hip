import { describe, expect, it } from 'vitest'
import {
  applyFilters,
  avgRows,
  clampWidth,
  compareCells,
  countNonEmpty,
  createColumn,
  createEmptyTable,
  createTableHistory,
  csvToTable,
  fallbackColsForRows,
  isEqualTable,
  metaFromTable,
  normalizeColType,
  normalizeMeta,
  parseCsv,
  serializeCsv,
  sortRows,
  sumRows,
  tableToCsv,
  DEFAULT_COL_WIDTH,
  MIN_COL_WIDTH,
  MAX_COL_WIDTH,
} from './tableModel'

describe('createEmptyTable', () => {
  it('creates 3×3 text table by default', () => {
    const t = createEmptyTable()
    expect(t.cols).toHaveLength(3)
    expect(t.rows).toHaveLength(3)
    for (const c of t.cols) {
      expect(c.type).toBe('text')
      expect(c.width).toBe(DEFAULT_COL_WIDTH)
      expect(c.name).toBe('')
    }
    expect(t.rows[0]).toEqual(['', '', ''])
  })

  it('supports custom dimensions and id uniqueness', () => {
    const t = createEmptyTable(1, 2)
    expect(t.cols.map((c) => c.id)).toEqual(['col_1', 'col_2'])
    const c = createColumn('number', t)
    expect(c.id).toBe('col_3')
  })
})

describe('CSV round-trip (RFC 4180)', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(parseCsv('a,b')).toEqual([['a', 'b']])
  })

  it('handles quoted fields with commas, quotes, newlines and CRLF', () => {
    const text = '"a,1","he said ""hi""","line1\nline2"\r\n"x","y","z"\r\n'
    expect(parseCsv(text)).toEqual([
      ['a,1', 'he said "hi"', 'line1\nline2'],
      ['x', 'y', 'z'],
    ])
  })

  it('strips BOM', () => {
    expect(parseCsv('\uFEFFa,b\n')).toEqual([['a', 'b']])
  })

  it('round-trips escaped content', () => {
    const rows = [
      ['plain', 'comma, inside', 'quote " here', 'multi\nline', 'cr\rlf'],
      ['', 'x', '', '', ''],
    ]
    expect(parseCsv(serializeCsv(rows))).toEqual(rows)
  })

  it('empty input parses to empty rows', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\n\n')).toEqual([])
  })
})

describe('meta merge and fallback', () => {
  it('normalizes valid meta', () => {
    const cols = normalizeMeta({
      cols: [
        { id: 'col_1', name: '任务', type: 'text', width: 200 },
        { id: 'col_2', name: '预算', type: 'number', width: 30 },
        { id: 'col_3', name: '状态', type: 'select', options: ['待办', '待办', '完成'] },
      ],
    })
    expect(cols).toHaveLength(3)
    expect(cols![0]).toEqual({ id: 'col_1', name: '任务', type: 'text', width: 200 })
    expect(cols![1].width).toBe(MIN_COL_WIDTH) // 30 → clamped to 48
    expect(cols![2].options).toEqual(['待办', '完成']) // deduped
  })

  it('falls back per-field on junk', () => {
    const cols = normalizeMeta({ cols: [{ id: 'col_1', type: 'weird', width: 'wide' }] })
    expect(cols).toEqual([{ id: 'col_1', name: '', type: 'text', width: DEFAULT_COL_WIDTH }])
  })

  it('returns null for structurally invalid meta', () => {
    expect(normalizeMeta(null)).toBeNull()
    expect(normalizeMeta({})).toBeNull()
    expect(normalizeMeta({ cols: 'x' })).toBeNull()
    expect(normalizeMeta({ cols: [{ name: 'no id' }] })).toBeNull()
    expect(normalizeMeta({ cols: [] })).toBeNull()
  })

  it('derives fallback columns from row width', () => {
    const cols = fallbackColsForRows([
      ['a', 'b', 'c'],
      ['x'],
    ])
    expect(cols).toHaveLength(3)
    expect(cols.every((c) => c.type === 'text' && c.name === '')).toBe(true)
  })

  it('csvToTable never loses rows on missing meta', () => {
    const t = csvToTable('a,b,c\n1,2,3\n', null)
    expect(t.rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
    expect(t.cols).toHaveLength(3)
    expect(t.cols[0].id).toBe('col_1')
  })

  it('metaFromTable + normalizeMeta round-trip preserves select options', () => {
    const t = createEmptyTable(2, 1)
    t.cols[0] = { ...t.cols[0], type: 'select', options: ['A', 'B'] }
    const meta = metaFromTable(t)
    const cols = normalizeMeta(meta)
    expect(cols![0].options).toEqual(['A', 'B'])
  })

  it('tableToCsv + csvToTable round-trip preserves data', () => {
    const t = createEmptyTable(2, 2)
    t.rows[0] = ['hello, world', 'quote "x"']
    t.rows[1] = ['多行\n内容', '42']
    const back = csvToTable(tableToCsv(t), metaFromTable(t))
    expect(back.rows).toEqual(t.rows)
    expect(back.cols.map((c) => c.id)).toEqual(t.cols.map((c) => c.id))
  })
})

describe('sort comparators (type-aware)', () => {
  it('compares numbers numerically with thousands separators', () => {
    expect(compareCells('1,200', '99', 'number')).toBeGreaterThan(0)
    expect(compareCells('50', '120', 'number')).toBeLessThan(0)
    expect(compareCells('50', '50', 'number')).toBe(0)
  })

  it('invalid numbers sort after valid ones, textually among themselves', () => {
    expect(compareCells('abc', '10', 'number')).toBeGreaterThan(0)
    expect(compareCells('10', 'xyz', 'number')).toBeLessThan(0)
    expect(compareCells('abc', 'xyz', 'number')).toBeLessThan(0)
  })

  it('compares dates via numeric value', () => {
    expect(compareCells('2026-03-01', '2025-12-31', 'date')).toBeGreaterThan(0)
    expect(compareCells('bad', '2026-01-01', 'date')).toBeGreaterThan(0)
  })

  it('compares checkboxes (checked first)', () => {
    expect(compareCells('1', '0', 'checkbox')).toBeGreaterThan(0)
    expect(compareCells('0', '1', 'checkbox')).toBeLessThan(0)
  })

  it('compares text case-insensitively', () => {
    expect(compareCells('B', 'a', 'text')).toBeGreaterThan(0)
  })

  it('sortRows is stable and respects direction', () => {
    const t = createEmptyTable(4, 1)
    t.cols[0] = { ...t.cols[0], type: 'number' }
    t.rows = [['5'], ['5'], ['1'], ['9']]
    const asc = sortRows(t, t.cols[0].id, 'asc')
    expect(asc.rows.map((r) => r[0])).toEqual(['1', '5', '5', '9'])
    const desc = sortRows(t, t.cols[0].id, 'desc')
    expect(desc.rows.map((r) => r[0])).toEqual(['9', '5', '5', '1'])
    // stable: equal keys keep original relative order
    expect(asc.rows[1][0]).toBe('5')
  })

  it('sortRows ignores unknown column', () => {
    const t = createEmptyTable(2, 1)
    expect(sortRows(t, 'col_99', 'asc')).toBe(t)
  })
})

describe('filters', () => {
  const t = createEmptyTable(4, 3)
  t.cols[1] = { ...t.cols[1], type: 'number' }
  t.rows = [
    ['任务 A', '100', '进行中'],
    ['任务 B', '20', '待办'],
    ['任务 C', '300', '进行中'],
    ['', '', ''],
  ]

  it('contains (case-insensitive)', () => {
    const f = { colIndex: 0, op: 'contains' as const, value: '任务 b' }
    expect(applyFilters(t, [f]).rows).toEqual([t.rows[1]])
  })

  it('equals', () => {
    const f = { colIndex: 2, op: 'equals' as const, value: '进行中' }
    expect(applyFilters(t, [f]).rows).toEqual([t.rows[0], t.rows[2]])
  })

  it('isNotEmpty', () => {
    const f = { colIndex: 1, op: 'isNotEmpty' as const, value: '' }
    expect(applyFilters(t, [f]).rows).toEqual([t.rows[0], t.rows[1], t.rows[2]])
  })

  it('gt / lt on numbers', () => {
    expect(applyFilters(t, [{ colIndex: 1, op: 'gt', value: '50' }]).rows).toEqual([
      t.rows[0],
      t.rows[2],
    ])
    expect(applyFilters(t, [{ colIndex: 1, op: 'lt', value: '50' }]).rows).toEqual([
      t.rows[1],
    ])
  })

  it('checkbox equals maps 1/0', () => {
    const c = createEmptyTable(2, 1)
    c.cols[0] = { ...c.cols[0], type: 'checkbox' }
    c.rows = [['1'], ['0'], ['']]
    expect(applyFilters(c, [{ colIndex: 0, op: 'equals', value: '1' }]).rows).toEqual([['1']])
    expect(applyFilters(c, [{ colIndex: 0, op: 'equals', value: '0' }]).rows).toEqual([
      ['0'],
      [''],
    ])
  })

  it('multiple conditions AND together', () => {
    const fs = [
      { colIndex: 2, op: 'equals' as const, value: '进行中' },
      { colIndex: 1, op: 'gt' as const, value: '150' },
    ]
    expect(applyFilters(t, fs).rows).toEqual([t.rows[2]])
  })

  it('empty filter list is identity', () => {
    expect(applyFilters(t, [])).toBe(t)
  })
})

describe('stats (visible rows)', () => {
  const rows = [
    ['50', 'abc', '1,200'],
    ['100', 'x', '80'],
    ['', 'y', ''],
    ['50.5', 'z', '0'],
  ]

  it('sum skips invalid and empty cells', () => {
    expect(sumRows(rows, 0)).toBe(200.5)
    expect(sumRows(rows, 1)).toBe(0)
  })

  it('avg over valid cells only', () => {
    expect(avgRows(rows, 0)).toBeCloseTo(66.8333, 3)
    expect(avgRows(rows, 1)).toBe(0)
  })

  it('count counts non-empty', () => {
    expect(countNonEmpty(rows, 0)).toBe(3)
    expect(countNonEmpty(rows, 1)).toBe(4)
    expect(countNonEmpty(rows, 2)).toBe(3)
  })
})

describe('undo history', () => {
  it('undo/redo restores data and sort state', () => {
    const h = createTableHistory()
    const t0 = createEmptyTable(2, 1)
    h.reset({ table: t0, sort: null })

    const t1 = { cols: t0.cols, rows: [['a'], ['b']] }
    h.push({ table: t1, sort: { col: 'col_1', dir: 'asc' } })
    const t2 = { cols: t0.cols, rows: [['a'], ['c']] }
    h.push({ table: t2, sort: null })

    expect(h.canUndo()).toBe(true)
    expect(h.canRedo()).toBe(false)
    const back = h.undo()!
    expect(back.table.rows).toEqual([['a'], ['b']])
    expect(back.sort).toEqual({ col: 'col_1', dir: 'asc' })
    expect(h.canRedo()).toBe(true)
    const fwd = h.redo()!
    expect(fwd.table.rows).toEqual([['a'], ['c']])
    // 可一路撤回到初始状态（cursor=0），再撤返回 null
    expect(h.undo()!.table.rows).toEqual([['a'], ['b']])
    expect(h.undo()!.table.rows).toEqual([[''], ['']])
    expect(h.undo()).toBeNull()
  })

  it('push trims redo branch', () => {
    const h = createTableHistory()
    const t0 = createEmptyTable(1, 1)
    h.reset({ table: t0, sort: null })
    h.push({ table: { ...t0, rows: [['a']] }, sort: null })
    h.push({ table: { ...t0, rows: [['b']] }, sort: null })
    expect(h.undo()).not.toBeNull()
    h.push({ table: { ...t0, rows: [['c']] }, sort: null })
    expect(h.redo()).toBeNull()
    expect(h.undo()!.table.rows).toEqual([['a']])
  })

  it('dedupes identical consecutive snapshots', () => {
    const h = createTableHistory()
    const t0 = createEmptyTable(1, 1)
    h.reset({ table: t0, sort: null })
    h.push({ table: t0, sort: null })
    h.push({ table: t0, sort: null })
    expect(h.undo()).toBeNull()
  })

  it('caps stack at limit (oldest dropped)', () => {
    const h = createTableHistory(3)
    const t0 = createEmptyTable(1, 1)
    h.reset({ table: t0, sort: null })
    for (let i = 1; i <= 5; i++) {
      h.push({ table: { ...t0, rows: [[String(i)]] }, sort: null })
    }
    let steps = 0
    while (h.undo()) steps++
    expect(steps).toBe(2) // 3-cap: bottom + 2 undos
  })

  it('snapshots are isolated from later mutation', () => {
    const h = createTableHistory()
    const t0 = createEmptyTable(1, 1)
    h.reset({ table: t0, sort: null })
    const snap = { table: { ...t0, rows: [['x']] }, sort: null }
    h.push(snap)
    h.push({ table: { ...t0, rows: [['y']] }, sort: null })
    snap.table.rows[0][0] = 'mutated'
    const back = h.undo()!
    expect(back.table.rows[0][0]).toBe('x')
  })
})

describe('misc helpers', () => {
  it('normalizeColType falls back to text', () => {
    expect(normalizeColType('number')).toBe('number')
    expect(normalizeColType('select')).toBe('select')
    expect(normalizeColType('bogus')).toBe('text')
    expect(normalizeColType(undefined)).toBe('text')
  })

  it('clampWidth bounds to [48, 600]', () => {
    expect(clampWidth(10)).toBe(MIN_COL_WIDTH)
    expect(clampWidth(900)).toBe(MAX_COL_WIDTH)
    expect(clampWidth(200)).toBe(200)
    expect(clampWidth(200.6)).toBe(201)
    expect(clampWidth(Number.NaN)).toBe(DEFAULT_COL_WIDTH)
  })

  it('isEqualTable compares deep', () => {
    const a = createEmptyTable(1, 1)
    const b = createEmptyTable(1, 1)
    expect(isEqualTable(a, b)).toBe(true)
    b.rows[0][0] = 'x'
    expect(isEqualTable(a, b)).toBe(false)
  })
})
