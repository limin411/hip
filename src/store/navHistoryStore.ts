import { create } from 'zustand'
import type { ActiveView, AppOverlay, SettingsPageId, SidebarSection } from '@/store/uiStore'

/**
 * Work surfaces for new captures. Legacy stack frames may still hold AppOverlay
 * values (settings/history/trash); applyNavEntry coerces those to overlays.
 */
export type NavEntryActiveView = ActiveView | AppOverlay

/** Snapshot of shell location for back/forward (ChatGPT-style browsing history). */
export type NavEntry = {
  activeView: NavEntryActiveView
  sidebarSection: SidebarSection
  sessionId: string | null
  knowledgeSpaceId: string | null
  settingsPage: SettingsPageId
  managedTerminalId: string | null
}

const MAX_STACK = 50

export function navEntriesEqual(a: NavEntry, b: NavEntry): boolean {
  return (
    a.activeView === b.activeView &&
    a.sidebarSection === b.sidebarSection &&
    a.sessionId === b.sessionId &&
    a.knowledgeSpaceId === b.knowledgeSpaceId &&
    a.settingsPage === b.settingsPage &&
    a.managedTerminalId === b.managedTerminalId
  )
}

interface NavHistoryState {
  stack: NavEntry[]
  index: number
  /** True while applying back/forward — skip recording. */
  applying: boolean

  canGoBack: () => boolean
  canGoForward: () => boolean

  /** Replace stack with a single seed entry (cold launch / tests). */
  reset: (entry: NavEntry) => void

  /**
   * Push a new location after user navigation. Truncates any forward branch.
   * No-ops when equal to current entry or while applying history.
   */
  push: (entry: NavEntry) => void

  /** Move index back; returns entry to apply, or null. */
  back: () => NavEntry | null
  /** Move index forward; returns entry to apply, or null. */
  forward: () => NavEntry | null

  setApplying: (v: boolean) => void
}

export const useNavHistoryStore = create<NavHistoryState>((set, get) => ({
  stack: [],
  index: -1,
  applying: false,

  canGoBack: () => {
    const { index } = get()
    return index > 0
  },

  canGoForward: () => {
    const { stack, index } = get()
    return index >= 0 && index < stack.length - 1
  },

  reset: (entry) => set({ stack: [entry], index: 0 }),

  push: (entry) => {
    const { applying, stack, index } = get()
    if (applying) return
    const cur = index >= 0 ? stack[index] : undefined
    if (cur && navEntriesEqual(cur, entry)) return
    const base = index >= 0 ? stack.slice(0, index + 1) : []
    const next = [...base, entry]
    const trimmed = next.length > MAX_STACK ? next.slice(next.length - MAX_STACK) : next
    set({ stack: trimmed, index: trimmed.length - 1 })
  },

  back: () => {
    const { stack, index, applying } = get()
    if (applying || index <= 0) return null
    const nextIndex = index - 1
    set({ index: nextIndex })
    return stack[nextIndex] ?? null
  },

  forward: () => {
    const { stack, index, applying } = get()
    if (applying || index < 0 || index >= stack.length - 1) return null
    const nextIndex = index + 1
    set({ index: nextIndex })
    return stack[nextIndex] ?? null
  },

  setApplying: (v) => set({ applying: v }),
}))
