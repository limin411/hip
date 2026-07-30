/**
 * Board companion outline / selection signatures (LKD-20…32 pure bits).
 * Structure source = canvas elements (LKD-21); never JSON.parse(draftBody).
 */
import type { HipBoardElement, HipBoardElementType } from './boardScene'

/** Cap structure list size (virtualization later). */
export const BOARD_OUTLINE_MAX_ITEMS = 2000

export type BoardOutlineItem = {
  id: string
  type: HipBoardElementType
  label: string
  depth: number // v1: 0
  locked: boolean
  order: number
}

/** Style fields for rail editors — single-select full; multi-select common subset */
export type BoardSelectionStyleSnapshot = {
  fill?: string
  stroke?: string
  strokeWidth?: number
  fontSize?: 12 | 16 | 24
  text?: string
  /** true if values differ across multi-select */
  mixed?: Partial<Record<'fill' | 'stroke' | 'strokeWidth' | 'fontSize' | 'text', boolean>>
}

export type BoardSelectionSnapshot = {
  boardId: string
  ids: string[] // sorted
  items: BoardOutlineItem[]
  /** Present when ids.length >= 1; drives LKD-10 editors */
  style: BoardSelectionStyleSnapshot
}

export type BoardOutline = {
  boardId: string
  items: BoardOutlineItem[]
  totalElements: number
  truncated: boolean
  imageCount: number
}

export function selectionIdsSignature(ids: readonly string[]): string {
  return [...ids].sort().join('\0')
}

/** Include style bits so text/fill edits refresh rail without id change */
export function selectionPublishSignature(
  ids: readonly string[],
  style: BoardSelectionStyleSnapshot,
): string {
  return selectionIdsSignature(ids) + '\n' + JSON.stringify(style)
}

export function boardOutlineSignature(elements: readonly HipBoardElement[]): string {
  return elements
    .map((e) => {
      const labelBit = e.type === 'text' ? e.text.slice(0, 24) : e.type
      return `${e.id}|${e.type}|${labelBit}`
    })
    .join('\n')
}

function shortId(id: string): string {
  if (id.length <= 8) return id
  return id.slice(0, 8)
}

/** Label for structure row: text content or `type+shortId`. */
export function outlineLabelForElement(el: HipBoardElement): string {
  if (el.type === 'text') {
    const t = el.text.replace(/\n/g, ' ').trim()
    if (t.length > 0) return t.length > 40 ? `${t.slice(0, 40)}…` : t
  }
  return `${el.type} ${shortId(el.id)}`
}

export function extractBoardOutline(
  boardId: string,
  elements: readonly HipBoardElement[],
  opts?: { maxItems?: number },
): BoardOutline {
  const maxItems = opts?.maxItems ?? BOARD_OUTLINE_MAX_ITEMS
  const totalElements = elements.length
  let imageCount = 0
  for (const el of elements) {
    if (el.type === 'image') imageCount++
  }
  const slice = elements.slice(0, maxItems)
  const items: BoardOutlineItem[] = slice.map((el, order) => ({
    id: el.id,
    type: el.type,
    label: outlineLabelForElement(el),
    depth: 0,
    locked: el.locked === true,
    order,
  }))
  return {
    boardId,
    items,
    totalElements,
    truncated: totalElements > maxItems,
    imageCount,
  }
}

/**
 * Build a selection style snapshot from selected elements.
 * Multi-select: shared fields only; mixed flags when values differ.
 */
export function buildSelectionStyleSnapshot(
  elements: readonly HipBoardElement[],
  selectedIds: readonly string[],
): BoardSelectionStyleSnapshot {
  const idSet = new Set(selectedIds)
  const selected = elements.filter((e) => idSet.has(e.id))
  if (selected.length === 0) return {}

  const fills: string[] = []
  const strokes: string[] = []
  const strokeWidths: number[] = []
  const fontSizes: Array<12 | 16 | 24> = []
  const texts: string[] = []

  for (const el of selected) {
    if (el.type === 'rect' || el.type === 'ellipse') {
      fills.push(el.fill)
      strokes.push(el.stroke)
      strokeWidths.push(el.strokeWidth)
    } else if (el.type === 'line' || el.type === 'arrow') {
      strokes.push(el.stroke)
      strokeWidths.push(el.strokeWidth)
    } else if (el.type === 'text') {
      fills.push(el.fill)
      fontSizes.push(el.fontSize)
      texts.push(el.text)
    }
  }

  const mixed: BoardSelectionStyleSnapshot['mixed'] = {}
  const out: BoardSelectionStyleSnapshot = {}

  const unique = <T>(arr: T[]): T[] => [...new Set(arr)]

  if (fills.length > 0) {
    const u = unique(fills)
    out.fill = u[0]
    if (u.length > 1) mixed.fill = true
  }
  if (strokes.length > 0) {
    const u = unique(strokes)
    out.stroke = u[0]
    if (u.length > 1) mixed.stroke = true
  }
  if (strokeWidths.length > 0) {
    const u = unique(strokeWidths)
    out.strokeWidth = u[0]
    if (u.length > 1) mixed.strokeWidth = true
  }
  if (fontSizes.length > 0) {
    const u = unique(fontSizes)
    out.fontSize = u[0]
    if (u.length > 1) mixed.fontSize = true
  }
  if (texts.length > 0) {
    const u = unique(texts)
    out.text = u[0]
    if (u.length > 1) mixed.text = true
  }

  if (Object.keys(mixed).length > 0) out.mixed = mixed
  return out
}

export function buildSelectionSnapshot(
  boardId: string,
  elements: readonly HipBoardElement[],
  selectedIds: readonly string[],
): BoardSelectionSnapshot {
  const ids = [...selectedIds].sort()
  const idSet = new Set(ids)
  const items: BoardOutlineItem[] = []
  elements.forEach((el, order) => {
    if (!idSet.has(el.id)) return
    items.push({
      id: el.id,
      type: el.type,
      label: outlineLabelForElement(el),
      depth: 0,
      locked: el.locked === true,
      order,
    })
  })
  return {
    boardId,
    ids,
    items,
    style: buildSelectionStyleSnapshot(elements, ids),
  }
}
