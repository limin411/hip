/**
 * Shell navigation helpers for AppSidebar / MainToolbar / command palette / account chrome.
 * Single source of truth for leave-knowledge flush and section routing (see design spec).
 */
import { sessionService } from '@/domain'
import { useDomainStore } from '@/domain'
import { surfaceOf } from '@/lib/sessions'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useUiStore, type SidebarSection } from '@/store/uiStore'

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

export async function enterKnowledge(): Promise<void> {
  useUiStore.getState().openKnowledgeView()
  useUiStore.getState().setSidebarSection('knowledge')
  await useKnowledgeStore.getState().loadSpaces()
}

/** Open knowledge surface on the home (spaces list) for management. */
export async function openKnowledgeHome(): Promise<void> {
  await enterKnowledge()
  await useKnowledgeStore.getState().openHome()
}

export async function enterSection(section: 'projects' | 'chats'): Promise<void> {
  // Only await when leaving knowledge so non-knowledge callers stay sync (palette tests / click handlers).
  if (useUiStore.getState().activeView === 'knowledge') {
    await leaveKnowledge()
  }
  useUiStore.getState().setSidebarSection(section)
  sessionService.setSurface(section === 'projects' ? 'code' : 'chat')
}

export async function selectSessionFromSidebar(id: string): Promise<void> {
  if (useUiStore.getState().activeView === 'knowledge') {
    await leaveKnowledge()
  }
  sessionService.selectSession(id)
}

export async function newConversationFromSidebar(surface: 'chat' | 'code'): Promise<void> {
  if (useUiStore.getState().activeView === 'knowledge') {
    await leaveKnowledge()
  }
  sessionService.newConversation(surface)
  useUiStore.getState().setSidebarSection(surface === 'code' ? 'projects' : 'chats')
}

export async function openSpaceFromSidebar(spaceId: string): Promise<void> {
  if (useUiStore.getState().activeView !== 'knowledge') {
    await enterKnowledge()
  } else {
    useUiStore.getState().setSidebarSection('knowledge')
  }
  await useKnowledgeStore.getState().openSpace(spaceId)
}

export async function openSettingsFromChrome(): Promise<void> {
  const wasKnowledge = useUiStore.getState().activeView === 'knowledge'
  if (wasKnowledge) {
    await leaveKnowledge()
    assignSectionAfterLeavingKnowledge()
  }
  useUiStore.getState().setActiveView('settings')
}

export async function openHistoryFromChrome(): Promise<void> {
  const wasKnowledge = useUiStore.getState().activeView === 'knowledge'
  if (wasKnowledge) {
    await leaveKnowledge()
    assignSectionAfterLeavingKnowledge()
  }
  useUiStore.getState().setActiveView('history')
}

/** MainToolbar / special-view back — keep section in sync with restored view. */
export function handleMainToolbarBack(): void {
  const target = useUiStore.getState().previousView ?? 'chat'
  useUiStore.getState().setActiveView(target)
  if (target === 'knowledge') {
    useUiStore.getState().setSidebarSection('knowledge')
  } else if (target === 'chat' || target === 'code') {
    useUiStore.getState().setSidebarSection(target === 'code' ? 'projects' : 'chats')
  }
}

export function sectionForSurface(surface: 'chat' | 'code'): SidebarSection {
  return surface === 'code' ? 'projects' : 'chats'
}
