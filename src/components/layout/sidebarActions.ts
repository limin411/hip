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

/** After leaving knowledge for settings/history (not for setSurface/selectSession). */
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
  useUiStore.getState().setSidebarSection(section)
  sessionService.setSurface(section === 'projects' ? 'code' : 'chat')
  recordNavEntry()
}

/** Enter a primary-nav placeholder (workbench / tasks / automation; terminals when flag off). */
export async function enterPlaceholderSection(section: PlaceholderSidebarSection): Promise<void> {
  await leaveActiveSurfaceIfNeeded()
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
 * Already on tasks: leaveWorkItems would flush unnecessarily — skip.
 */
export async function enterWorkItemsSection(): Promise<void> {
  if (useUiStore.getState().activeView === 'knowledge') {
    await leaveKnowledge()
  }
  useUiStore.getState().setSidebarSection('tasks')
  useUiStore.getState().setActiveView('tasks')
  recordNavEntry()
  if (!useWorkItemStore.getState().loaded) {
    void useWorkItemStore.getState().load()
  }
}

export async function selectSessionFromSidebar(id: string): Promise<void> {
  await leaveActiveSurfaceIfNeeded()
  sessionService.selectSession(id)
  recordNavEntry()
}

export async function newConversationFromSidebar(surface: 'chat' | 'code'): Promise<void> {
  await leaveActiveSurfaceIfNeeded()
  sessionService.newConversation(surface)
  useUiStore.getState().setSidebarSection(surface === 'code' ? 'projects' : 'chats')
  recordNavEntry()
}

export async function openSpaceFromSidebar(spaceId: string): Promise<void> {
  // Don't go through enterKnowledge (which auto-opens first space) — open the
  // requested id only. Still ensure view + spaces are ready.
  if (useUiStore.getState().activeView === 'tasks') {
    await leaveWorkItems()
  }
  useUiStore.getState().openKnowledgeView()
  useUiStore.getState().setSidebarSection('knowledge')
  const kb = useKnowledgeStore.getState()
  if (!kb.loaded) {
    await kb.loadSpaces()
  }
  await useKnowledgeStore.getState().openSpace(spaceId)
  recordNavEntry()
}

export async function openSettingsFromChrome(): Promise<void> {
  const view = useUiStore.getState().activeView
  if (view === 'knowledge') {
    await leaveKnowledge()
    assignSectionAfterLeavingKnowledge()
  } else if (view === 'tasks') {
    await leaveWorkItems()
  }
  // Always land on General when opening Settings from chrome (not last-visited page).
  useUiStore.getState().setSettingsPage('general')
  useUiStore.getState().setActiveView('settings')
  recordNavEntry()
}

export async function openHistoryFromChrome(): Promise<void> {
  const view = useUiStore.getState().activeView
  if (view === 'knowledge') {
    await leaveKnowledge()
    assignSectionAfterLeavingKnowledge()
  } else if (view === 'tasks') {
    await leaveWorkItems()
  }
  useUiStore.getState().setActiveView('history')
  recordNavEntry()
}

export async function openTrashFromChrome(): Promise<void> {
  const view = useUiStore.getState().activeView
  if (view === 'knowledge') {
    await leaveKnowledge()
    assignSectionAfterLeavingKnowledge()
  } else if (view === 'tasks') {
    await leaveWorkItems()
  }
  useUiStore.getState().setActiveView('trash')
  // Opportunistic list + purge
  void import('@/domain').then(({ sessionService }) => {
    sessionService.requestTrashList()
  })
  recordNavEntry()
}

export async function openAutomationFromChrome(): Promise<void> {
  const view = useUiStore.getState().activeView
  if (view === 'knowledge') {
    await leaveKnowledge()
    assignSectionAfterLeavingKnowledge()
  } else if (view === 'tasks') {
    await leaveWorkItems()
  }
  useUiStore.getState().setActiveView('automation')
  recordNavEntry()
}

/**
 * MainToolbar / special-view back — keep section in sync with restored view.
 * K19: await leaveWorkItems when leaving tasks (notes debounce + finalize).
 */
export async function handleMainToolbarBack(): Promise<void> {
  if (useUiStore.getState().activeView === 'tasks') {
    await leaveWorkItems()
  }
  const target = useUiStore.getState().previousView ?? 'workbench'
  useUiStore.getState().setActiveView(target)
  if (target === 'knowledge') {
    useUiStore.getState().setSidebarSection('knowledge')
  } else if (
    target === 'workbench' ||
    target === 'terminals' ||
    target === 'tasks' ||
    target === 'automation'
  ) {
    useUiStore.getState().setSidebarSection(target)
  } else if (target === 'chat' || target === 'code') {
    useUiStore.getState().setSidebarSection(target === 'code' ? 'projects' : 'chats')
  }
  recordNavEntry()
}

export function sectionForSurface(surface: 'chat' | 'code'): SidebarSection {
  return surface === 'code' ? 'projects' : 'chats'
}
