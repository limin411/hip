/**
 * Shell back/forward history (ChatGPT Desktop-style).
 * Captures / restores active view, sidebar section, session, knowledge space, etc.
 * Overlay open/close is not recorded; apply always clears overlay first.
 */
import { sessionService, useDomainStore } from '@/domain'
import { coerceUnderlyingFromEntry } from '@/lib/overlayNav'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { type NavEntry, useNavHistoryStore } from '@/store/navHistoryStore'
import { useUiStore } from '@/store/uiStore'
import { useWorkItemStore } from '@/store/workItemStore'

export function captureNavEntry(): NavEntry {
  const ui = useUiStore.getState()
  const domain = useDomainStore.getState()
  const kb = useKnowledgeStore.getState()
  const managed = useManagedTerminalStore.getState()
  return {
    activeView: ui.activeView,
    sidebarSection: ui.sidebarSection,
    sessionId: domain.activeSessionId,
    knowledgeSpaceId: kb.activeSpaceId,
    settingsPage: ui.settingsPage,
    managedTerminalId: managed.focusedId,
  }
}

/** Record the current shell location after a user navigation completes. */
export function recordNavEntry(): void {
  useNavHistoryStore.getState().push(captureNavEntry())
}

/**
 * Seed history with the current location when the stack is empty (cold launch).
 * Safe to call repeatedly.
 */
export function seedNavHistoryIfEmpty(): void {
  const { stack } = useNavHistoryStore.getState()
  if (stack.length === 0) {
    useNavHistoryStore.getState().reset(captureNavEntry())
  }
}

/** Force-reset history to the current shell location (cold launch). */
export function seedColdLaunchNavHistory(): void {
  useNavHistoryStore.getState().reset(captureNavEntry())
}

async function flushKnowledgeIfNeeded(leavingKnowledge: boolean): Promise<void> {
  if (!leavingKnowledge) return
  try {
    await useKnowledgeStore.getState().flushSave()
  } catch {
    // non-Tauri / not loaded
  }
}

/** K19: finalize + drain work-item save chain when leaving tasks (mirrors leaveWorkItems). */
async function flushWorkItemsIfNeeded(leavingTasks: boolean): Promise<void> {
  if (!leavingTasks) return
  try {
    await useWorkItemStore.getState().flushSave()
  } catch {
    // non-Tauri / not loaded
  }
}

async function restoreKnowledge(spaceId: string | null): Promise<void> {
  useUiStore.getState().openKnowledgeView()
  useUiStore.getState().setSidebarSection('knowledge')
  const kb = useKnowledgeStore.getState()
  if (!kb.loaded) {
    await kb.loadSpaces()
  }
  if (spaceId && useKnowledgeStore.getState().spaces.some((s) => s.id === spaceId)) {
    await useKnowledgeStore.getState().openSpace(spaceId)
  }
}

/**
 * Restore a history entry. Suppresses recording while applying.
 * Missing sessions fall back to empty chat/code surface.
 */
export async function applyNavEntry(entry: NavEntry): Promise<void> {
  const store = useNavHistoryStore.getState()
  store.setApplying(true)
  try {
    // Always clear overlay first — back/forward restores work surface, not shells.
    useUiStore.getState().setOverlay(null)

    const prevView = useUiStore.getState().activeView
    if (prevView === 'knowledge' && entry.activeView !== 'knowledge') {
      await flushKnowledgeIfNeeded(true)
    }
    // K19: leave tasks (finalize + save chain) before restoring non-tasks entry.
    if (prevView === 'tasks' && entry.activeView !== 'tasks') {
      await flushWorkItemsIfNeeded(true)
    }

    // Legacy special-view frames: settings/history/trash reopen as overlays over coerced surface.
    if (
      entry.activeView === 'history' ||
      entry.activeView === 'trash' ||
      entry.activeView === 'settings'
    ) {
      const surface = coerceUnderlyingFromEntry(entry)
      useUiStore.getState().setSidebarSection(surface.section)
      useUiStore.getState().setActiveView(surface.view)
      if (entry.activeView === 'settings') {
        useUiStore.getState().setSettingsPage(entry.settingsPage)
      }
      if (entry.sessionId) {
        const exists = useDomainStore.getState().sessions.some((s) => s.id === entry.sessionId)
        if (exists) sessionService.selectSession(entry.sessionId)
      }
      useUiStore.getState().setOverlay(entry.activeView)
      if (entry.activeView === 'trash') {
        void sessionService.requestTrashList()
      }
      return
    }

    if (entry.activeView === 'knowledge') {
      await restoreKnowledge(entry.knowledgeSpaceId)
      return
    }

    useUiStore.getState().setSidebarSection(entry.sidebarSection)
    useUiStore.getState().setActiveView(entry.activeView)

    if (entry.activeView === 'terminals') {
      useManagedTerminalStore.getState().focus(entry.managedTerminalId)
    }

    if (entry.sessionId) {
      const exists = useDomainStore.getState().sessions.some((s) => s.id === entry.sessionId)
      if (exists) {
        sessionService.selectSession(entry.sessionId)
        return
      }
      useDomainStore.getState().deselect()
      if (entry.activeView === 'chat' || entry.activeView === 'code') {
        useUiStore.getState().setActiveView(entry.activeView)
        useUiStore
          .getState()
          .setSidebarSection(entry.activeView === 'code' ? 'projects' : 'chats')
      }
      return
    }

    useDomainStore.getState().deselect()
    if (entry.activeView === 'chat' || entry.activeView === 'code') {
      useUiStore
        .getState()
        .setSidebarSection(entry.activeView === 'code' ? 'projects' : 'chats')
    }
  } finally {
    useNavHistoryStore.getState().setApplying(false)
  }
}

export async function goNavBack(): Promise<boolean> {
  seedNavHistoryIfEmpty()
  const entry = useNavHistoryStore.getState().back()
  if (!entry) return false
  await applyNavEntry(entry)
  return true
}

export async function goNavForward(): Promise<boolean> {
  seedNavHistoryIfEmpty()
  const entry = useNavHistoryStore.getState().forward()
  if (!entry) return false
  await applyNavEntry(entry)
  return true
}
