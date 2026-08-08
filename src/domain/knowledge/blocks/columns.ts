/**
 * Columns block (V2-E1): 2–4 列分栏。
 *
 * - 磁盘格式：HTML 注释守卫（可读、可手工编辑、破损可容错降级为段落）：
 *   ```
 *   <!-- hip-columns:2 -->
 *   col1 md…
 *   <!-- hip-col -->
 *   col2 md…
 *   <!-- /hip-columns -->
 *   ```
 * - Live：`columns` 块（content: 'none'），每列内容以 Markdown 存于 props
 *   （`data-columns` JSON carrier）——与 callout/toggle 同手法（BN 0.52 自定义块
 *   不支持嵌套块内容）。
 * - 列宽（拖拽）仅存块属性，**不进入 Markdown**（doc-storage-spec L-8）。
 * - 守卫破损 → `extractColumnsGuard` 返回 null，按普通段落解析，不崩溃。
 */

export const COLUMNS_MIN = 2
export const COLUMNS_MAX = 4
export const COLUMN_WIDTH_MIN_PX = 100
export const COLUMN_WIDTH_MAX_PX = 600

export function columnsGuardOpen(count: number): string {
  return `<!-- hip-columns:${count} -->`
}
export const COLUMNS_GUARD_COL = '<!-- hip-col -->'
export const COLUMNS_GUARD_CLOSE = '<!-- /hip-columns -->'

/** Probe for FIDELITY_MATRIX / dialect-preserve tests. */
export const COLUMNS_GUARD_PROBE =
  /<!--\s*hip-columns:\d+\s*-->[\s\S]*?<!--\s*\/hip-columns\s*-->/i

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extract a well-formed columns guard from `md`.
 * Returns null when: no guard / count out of range / column count mismatch /
 * missing close marker (caller degrades to plain paragraphs).
 */
export function extractColumnsGuard(md: string): {
  count: number
  columns: string[]
} | null {
  const m = COLUMNS_GUARD_PROBE.exec(md)
  if (!m) return null
  const open = /<!--\s*hip-columns:(\d+)\s*-->/i.exec(m[0])
  if (!open) return null
  const count = Number(open[1])
  if (!Number.isInteger(count) || count < COLUMNS_MIN || count > COLUMNS_MAX) {
    return null
  }
  const inner = m[0].slice(open[0].length, -COLUMNS_GUARD_CLOSE.length)
  const cols = inner
    .split(new RegExp(`\\s*${escapeRe(COLUMNS_GUARD_COL)}\\s*`, 'i'))
    .map((s) => s.trim())
  if (cols.length !== count) return null
  if (cols.some((c) => c.length === 0)) return null
  return { count, columns: cols }
}

/** Serialize column segments back into the guard form (idempotent). */
export function joinColumnsGuard(count: number, columns: string[]): string {
  return `${columnsGuardOpen(count)}\n${columns.join(
    `\n${COLUMNS_GUARD_COL}\n`,
  )}\n${COLUMNS_GUARD_CLOSE}`
}

/** Guard → `data-columns` JSON string for the HTML carrier. */
export function columnsToJson(columns: string[]): string {
  return JSON.stringify(columns)
}

/** `data-columns` JSON → column strings (tolerant). */
export function jsonToColumns(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((c): c is string => typeof c === 'string')
  } catch {
    return []
  }
}
