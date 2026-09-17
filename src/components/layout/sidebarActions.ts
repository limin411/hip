/**
 * Shell navigation helpers for AppSidebar / MainToolbar / command palette / account chrome.
 * Single source of truth for section routing.
 */
import { sessionService } from '@/domain'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'

import {
  useUiStore,
  type PlaceholderSidebarSection,
  type SettingsPageId,
  type SidebarSection,
} from '@/store/uiStore'
import { recordNavEntry } from './navHistory'



/** Leave Settings main-column mode when navigating to a work surface. */
function dismissSettingsIfOpen(): void {
  if (useUiStore.getState().overlay === 'settings') {
    useUiStore.getState().setOverlay(null)
  }
}



export async function enterSection(section: 'projects' | 'chats'): Promise<void> {
  dismissSettingsIfOpen()
  useUiStore.getState().setSidebarSection(section)
  sessionService.setSurface(section === 'projects' ? 'code' : 'chat')
  recordNavEntry()
}

/** Enter a primary-nav placeholder (automation; terminals when flag off). */
export async function enterPlaceholderSection(section: PlaceholderSidebarSection): Promise<void> {
  dismissSettingsIfOpen()
  useUiStore.getState().setSidebarSection(section)
  useUiStore.getState().setActiveView(section)
  recordNavEntry()
}

/**
 * Enter terminal management (K14): set section + view.
 * Used when TERMINAL_MANAGEMENT is on; flag-off path still uses enterPlaceholderSection.
 *
 * @param opts.library When true (primary nav / "open terminal management"), clear
 *   focused managed terminal so the HostLibrary landing shows — not the last session.
 *   Omit when opening/focusing a specific terminal (openLocal, session row click).
 */
export async function enterTerminalsSection(opts?: {
  library?: boolean
}): Promise<void> {
  dismissSettingsIfOpen()
  if (opts?.library) {
    useManagedTerminalStore.getState().focus(null)
  }
  useUiStore.getState().setSidebarSection('terminals')
  useUiStore.getState().setActiveView('terminals')
  recordNavEntry()
}

/**
 * Select a session from sidebar / History (row or context-menu Open).
 * Selects session, records nav.
 * Dismisses history/trash/settings so the work surface is visible.
 */
export async function selectSessionFromSidebar(id: string): Promise<void> {
  sessionService.selectSession(id)
  recordNavEntry()
  const o = useUiStore.getState().overlay
  if (o === 'history' || o === 'trash' || o === 'settings') {
    useUiStore.getState().setOverlay(null)
  }
}

/** Alias: open session from History shell (same dismiss rules as sidebar select). */
export const openSessionFromHistory = selectSessionFromSidebar

export async function newConversationFromSidebar(surface: 'chat' | 'code'): Promise<void> {
  dismissSettingsIfOpen()
  sessionService.newConversation(surface)
  useUiStore.getState().setSidebarSection(surface === 'code' ? 'projects' : 'chats')
  recordNavEntry()
}


/**
 * Canonical Settings open. All product entry points must call this (or a thin wrapper).
 * Never assign settings as activeView — overlay === 'settings' owns the destination
 * (sidebar category rail + main-column body).
 *
 * Param semantics (page always wins when provided):
 * - If `page` is defined → setSettingsPage(page)
 * - Else if opts?.resetToGeneral !== false → setSettingsPage('general')
 * - Else → leave current settingsPage unchanged
 *
 * Intentional: do NOT leaveKnowledge / leaveWorkItems / recordNavEntry.
 */
export function openSettingsOverlay(
  page?: SettingsPageId,
  opts?: { resetToGeneral?: boolean },
): void {
  const ui = useUiStore.getState()
  if (page != null) {
    ui.setSettingsPage(page)
  } else if (opts?.resetToGeneral !== false) {
    ui.setSettingsPage('general')
  }
  // Always land on category page (pop any leftover L2 editor).
  ui.setSettingsShellRoute({ type: 'page' })
  // Settings needs the left rail for category nav.
  if (!ui.sidebarOpen) ui.setSidebarOpen(true)
  ui.setOverlay('settings')
}

/**
 * Footer / chrome toggle for Settings (re-click closes). Lands on General when opening.
 * No leave-flush, no recordNavEntry.
 */
export function openSettingsFromChrome(): void {
  const ui = useUiStore.getState()
  if (ui.overlay === 'settings') {
    ui.setOverlay(null)
    return
  }
  openSettingsOverlay() // no page → General
}

/**
 * Open History overlay shell. No leave-*, no recordNavEntry, no activeView change.
 * Work surface stays mounted underneath.
 */
export function openHistoryOverlay(): void {
  useUiStore.getState().setOverlay('history')
}

/** Footer / chrome toggle for History (re-click closes). */
export function toggleHistoryOverlay(): void {
  useUiStore.getState().toggleOverlay('history')
}

/**
 * Open Trash overlay shell. Requests trash list. No leave-*, no recordNavEntry.
 */
export function openTrashOverlay(): void {
  useUiStore.getState().setOverlay('trash')
  void import('@/domain').then(({ sessionService: svc }) => {
    svc.requestTrashList()
  })
}

/** Footer / chrome toggle for Trash (re-click closes). */
export function toggleTrashOverlay(): void {
  const ui = useUiStore.getState()
  if (ui.overlay === 'trash') {
    ui.setOverlay(null)
    return
  }
  openTrashOverlay()
}

export function closeOverlay(): void {
  useUiStore.getState().setOverlay(null)
}

/** @deprecated Prefer openHistoryOverlay / toggleHistoryOverlay — chrome openers now use overlays. */
export function openHistoryFromChrome(): void {
  openHistoryOverlay()
}

/** @deprecated Prefer openTrashOverlay / toggleTrashOverlay. */
export function openTrashFromChrome(): void {
  openTrashOverlay()
}

export function sectionForSurface(surface: 'chat' | 'code'): SidebarSection {
  return surface === 'code' ? 'projects' : 'chats'
}
