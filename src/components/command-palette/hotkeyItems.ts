import type { GlobalCommand, PaletteGroup } from './types'

/**
 * Flat list of items eligible for ⌘1–⌘9.
 * Nested-page entries (`to`) are excluded — they must not receive hotkey numbers
 * and must not be selected via number keys (keeps display index and keydown in sync).
 *
 * Contrast: `flattenVisibleItems` includes every row (including `to`).
 */
export function flattenHotkeyItems(groups: PaletteGroup[]): GlobalCommand[] {
  const out: GlobalCommand[] = []
  for (const g of groups) {
    for (const item of g.items) {
      if (item.to) continue
      out.push(item)
    }
  }
  return out
}

/** 1-based hotkey index for a command id within the hotkey list, or undefined if not in 1–9. */
export function hotkeyIndexForId(hotkeyItems: GlobalCommand[], id: string): number | undefined {
  const i = hotkeyItems.findIndex((c) => c.id === id)
  if (i < 0 || i >= 9) return undefined
  return i + 1
}
