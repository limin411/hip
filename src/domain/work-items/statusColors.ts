import type { WorkItem, WorkItemStatus } from './types'

/** User-editable status color keys (sidebar recolor). */
export type WorkItemStatusColorKey = 'todo' | 'in_progress' | 'done' | 'archived'

export type WorkItemColorMap = Record<WorkItemStatusColorKey, string>

/** Mockup defaults — high contrast on light surface. */
export const DEFAULT_STATUS_COLORS: WorkItemColorMap = {
  todo: '#3b82f6',
  in_progress: '#f59e0b',
  done: '#22c55e',
  archived: '#94a3b8',
}

/** Cancelled is fixed (not user-recolorable); distinct from archived. */
export const CANCELLED_STATUS_COLOR = '#a78bfa'

const HEX_RE = /^#([0-9a-fA-F]{6})$/

export function isValidStatusColorHex(s: string): boolean {
  return HEX_RE.test(s)
}

export function normalizeStatusColors(
  raw: unknown,
): WorkItemColorMap {
  const base = { ...DEFAULT_STATUS_COLORS }
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  for (const key of Object.keys(base) as WorkItemStatusColorKey[]) {
    const v = o[key]
    if (typeof v === 'string' && isValidStatusColorHex(v.trim())) {
      base[key] = v.trim().toLowerCase()
    }
  }
  return base
}

export type WorkItemUiPrefsV1 = {
  version: 1
  statusColors: WorkItemColorMap
}

export function defaultWorkItemUiPrefs(): WorkItemUiPrefsV1 {
  return {
    version: 1,
    statusColors: { ...DEFAULT_STATUS_COLORS },
  }
}

export function normalizeWorkItemUiPrefs(raw: unknown): WorkItemUiPrefsV1 {
  if (!raw || typeof raw !== 'object') return defaultWorkItemUiPrefs()
  const o = raw as Record<string, unknown>
  return {
    version: 1,
    statusColors: normalizeStatusColors(o.statusColors ?? o),
  }
}

/**
 * Color resolution key for bars/rows.
 * Archived (archivedAt set) wins over status; cancelled uses fixed key.
 */
export function colorKeyForItem(
  item: Pick<WorkItem, 'status' | 'archivedAt'>,
): WorkItemStatusColorKey | 'cancelled' {
  if (item.archivedAt != null) return 'archived'
  if (item.status === 'cancelled') return 'cancelled'
  if (item.status === 'todo' || item.status === 'in_progress' || item.status === 'done') {
    return item.status
  }
  return 'todo'
}

export function colorHexForItem(
  item: Pick<WorkItem, 'status' | 'archivedAt'>,
  colors: WorkItemColorMap,
): string {
  const key = colorKeyForItem(item)
  if (key === 'cancelled') return CANCELLED_STATUS_COLOR
  return colors[key] ?? DEFAULT_STATUS_COLORS.todo
}

export function statusLabelKey(status: WorkItemStatus): string {
  return `workItems.status.${status}`
}
