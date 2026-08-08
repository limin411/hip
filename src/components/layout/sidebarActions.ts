/**
 * Shell navigation helpers for AppSidebar / MainToolbar / command palette / account chrome.
 * Single source of truth for leave-knowledge / leave-work-items flush and section routing.
 */
import { sessionService } from '@/domain'
import { useDomainStore } from '@/domain'
import { surfaceOf } from '@/lib/sessions'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useWorkItemStore } from '@/store/workItemStore'
import {
  useUiStore,
  type PlaceholderSidebarSection,
  type SettingsPageId,
  type SidebarSection,
} from '@/store/uiStore'
import { recordNavEntry } from './navHistory'

/** Leave knowledge safely. Flush only — caller sets destination. No-op if not on knowledge. */
export async function leaveKnowledge(): Promise<void> {
  const ui = useUiStore.getState()
  if (ui.activeView !== 'knowledge') return
  try {
    await useKnowledgeStore.getState().flushSave()
  } catch {
    // non-Tauri / not loaded
  }
}

/**
 * Leave work items: finalize + drain save chain. No-op if not on tasks.
 * Call before any path that leaves `activeView === 'tasks'` (K19).
 */
export async function leaveWorkItems(): Promise<void> {
  if (useUiStore.getState().activeView !== 'tasks') return
  try {
    // Close modal session so form-local drafts do not resurrect on re-entry.
    const { useWorkItemViewStore } = await import('@/store/workItemViewStore')
    useWorkItemViewStore.getState().leaveWorkItems()
    await useWorkItemStore.getState().flushSave()
  } catch {
    // non-Tauri / not loaded
  }
}

/**
 * Flush leave-sensitive surfaces before navigating away.
 * Only awaits when currently on knowledge or tasks so other callers stay effectively sync.
 */
async function leaveActiveSurfaceIfNeeded(): Promise<void> {
  const view = useUiStore.getState().activeView
  if (view === 'knowledge') await leaveKnowledge()
  else if (view === 'tasks') await leaveWorkItems()
}

/** Leave Settings main-column mode when navigating to a work surface. */
function dismissSettingsIfOpen(): void {
  if (useUiStore.getState().overlay === 'settings') {
    useUiStore.getState().setOverlay(null)
  }
}

/**
 * After leaving knowledge/tasks for history/trash:
 * restore sidebar list to chats/projects so those special views are not paired
 * with a stale content list (e.g. work-item filters while main is RecycleBin).
 * Settings intentionally keeps the content section (see openSettingsFromChrome).
 */
export function assignSectionAfterLeavingKnowledge(): void {
  const domain = useDomainStore.getState()
  const active = domain.sessions.find((s) => s.id === domain.activeSessionId)
  if (active) {
    useUiStore
      .getState()
      .setSidebarSection(surfaceOf(active.config) === 'code' ? 'projects' : 'chats')
  } else {
    useUiStore.getState().setSidebarSection('chats')
  }
}

/** Alias for callers leaving tasks — same destination rule as knowledge. */
export const assignSectionAfterLeavingTasks = assignSectionAfterLeavingKnowledge

/** Name ascending — same order as the knowledge sidebar list. */
function firstSpaceIdByName(
  spaces: { id: string; name: string }[],
): string | null {
  if (spaces.length === 0) return null
  const sorted = [...spaces].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
  return sorted[0]?.id ?? null
}

/**
 * Enter knowledge: load spaces and open the first space by name.
 * Keeps the current workspace if it is still valid (no flash to empty/intro).
 * With zero spaces, stays on empty surface so the create CTA is available.
 */
export async function enterKnowledge(): Promise<void> {
  // Leave tasks if needed; do not leaveKnowledge (we are entering knowledge).
  if (useUiStore.getState().activeView === 'tasks') {
    await leaveWorkItems()
  }
  dismissSettingsIfOpen()
  useUiStore.getState().openKnowledgeView()
  useUiStore.getState().setSidebarSection('knowledge')
  await useKnowledgeStore.getState().loadSpaces()
  const state = useKnowledgeStore.getState()
  if (
    state.mode === 'workspace' &&
    state.activeSpaceId &&
    state.spaces.some((s) => s.id === state.activeSpaceId)
  ) {
    recordNavEntry()
    return
  }
  const firstId = firstSpaceIdByName(state.spaces)
  if (firstId) {
    await useKnowledgeStore.getState().openSpace(firstId)
  }
  recordNavEntry()
}

export async function enterSection(section: 'projects' | 'chats'): Promise<void> {
  // Only await when leaving knowledge/tasks so other callers stay sync (palette tests / click handlers).
  await leaveActiveSurfaceIfNeeded()
  dismissSettingsIfOpen()
  useUiStore.getState().setSidebarSection(section)
  sessionService.setSurface(section === 'projects' ? 'code' : 'chat')
  recordNavEntry()
}

/** Enter a primary-nav placeholder (tasks / automation; terminals when flag off). */
export async function enterPlaceholderSection(section: PlaceholderSidebarSection): Promise<void> {
  await leaveActiveSurfaceIfNeeded()
  dismissSettingsIfOpen()
  useUiStore.getState().setSidebarSection(section)
  useUiStore.getState().setActiveView(section)
  recordNavEntry()
}

/**
 * Enter terminal management (K14): leave knowledge/tasks if needed, set section + view.
 * Used when TERMINAL_MANAGEMENT is on; flag-off path still uses enterPlaceholderSection.
 *
 * @param opts.library When true (primary nav / “open terminal management”), clear
 *   focused managed terminal so the HostLibrary landing shows — not the last session.
 *   Omit when opening/focusing a specific terminal (openLocal, session row click).
 */
export async function enterTerminalsSection(opts?: {
  library?: boolean
}): Promise<void> {
  await leaveActiveSurfaceIfNeeded()
  dismissSettingsIfOpen()
  if (opts?.library) {
    useManagedTerminalStore.getState().focus(null)
  }
  useUiStore.getState().setSidebarSection('terminals')
  useUiStore.getState().setActiveView('terminals')
  recordNavEntry()
}

/**
 * Enter work-item tracking (tasks section).
 * AppSidebar wires onNav to this when WORK_ITEM_TRACKING is true.
 * Always forces activeView to `tasks` so re-entry from trash/settings/history works
 * even when sidebarSection is already `tasks` (stale pairing).
 * Already on tasks: leaveKnowledge/flush are skipped; still re-affirms view.
 */
export async function enterWorkItemsSection(): Promise<void> {
  const view = useUiStore.getState().activeView
  if (view === 'knowledge') {
    await leaveKnowledge()
  }
  dismissSettingsIfOpen()
  // Product default: every entry into 事项追踪 opens month calendar (D24).
  // Resets even when already on tasks so sidebar re-click and e2e re-entry match.
  const { useWorkItemViewStore } = await import('@/store/workItemViewStore')
  useWorkItemViewStore.getState().setViewMode('calendar')
  // Already showing work items — no-op beyond section + calendar default.
  if (view === 'tasks') {
    useUiStore.getState().setSidebarSection('tasks')
    return
  }
  useUiStore.getState().setSidebarSection('tasks')
  useUiStore.getState().setActiveView('tasks')
  recordNavEntry()
  if (!useWorkItemStore.getState().loaded) {
    void useWorkItemStore.getState().load()
  }
}


/**
 * Enter automations section.
 * AppSidebar wires onNav to this when AUTOMATION_PAGE is true.
 * Always forces activeView to `automation` so re-entry from trash/settings/history works
 * even when sidebarSection is already `automation` (stale pairing).
 */
export async function enterAutomationsSection(): Promise<void> {
  const view = useUiStore.getState().activeView
  if (view === 'knowledge') {
    await leaveKnowledge()
  } else if (view === 'tasks') {
    await leaveWorkItems()
  }
  dismissSettingsIfOpen()
  if (view === 'automation') {
    useUiStore.getState().setSidebarSection('automation')
    return
  }
  useUiStore.getState().setSidebarSection('automation')
  useUiStore.getState().setActiveView('automation')
  recordNavEntry()
  const { useAutomationStore } = await import('@/store/automationStore')
  if (!useAutomationStore.getState().loaded) {
    void useAutomationStore.getState().load()
  }
}

/**
 * Select a session from sidebar / History (row or context-menu Open).
 * Leaves knowledge/tasks if needed, selects session, records nav.
 * Dismisses history/trash/settings so the work surface is visible.
 */
export async function selectSessionFromSidebar(id: string): Promise<void> {
  await leaveActiveSurfaceIfNeeded()
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
  await leaveActiveSurfaceIfNeeded()
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

export async function openAutomationFromChrome(): Promise<void> {
  const { AUTOMATION_PAGE } = await import('@/components/automation/feature')
  if (AUTOMATION_PAGE) {
    await enterAutomationsSection()
    return
  }
  const view = useUiStore.getState().activeView
  if (view === 'knowledge') {
    await leaveKnowledge()
    assignSectionAfterLeavingKnowledge()
  } else if (view === 'tasks') {
    await leaveWorkItems()
    assignSectionAfterLeavingTasks()
  }
  useUiStore.getState().setActiveView('automation')
  recordNavEntry()
}

export function sectionForSurface(surface: 'chat' | 'code'): SidebarSection {
  return surface === 'code' ? 'projects' : 'chats'
}
