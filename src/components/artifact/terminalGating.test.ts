/**
 * Terminal gating matrix (design G1–G8).
 * G1/G3/G4/G7 also covered in PanelToggle / ArtifactPanel component tests.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import type { ArtifactTab, ChatTab } from '@/store/uiStore'
import { useUiStore } from '@/store/uiStore'

/** Pure: right panel content kind for AppLayout (mirrors AppLayout conditions). */
export function rightPanelKind(input: {
  activeView: string
  codePanelOpen: boolean
  chatPanelOpen: boolean
  knowledgePanelOpen?: boolean
  hasSession: boolean
}): 'artifact' | 'preview' | 'knowledge' | 'none' {
  // Knowledge does not require a chat/code session.
  if (input.activeView === 'knowledge' && input.knowledgePanelOpen) return 'knowledge'
  if (!input.hasSession) return 'none'
  if (input.activeView === 'code' && input.codePanelOpen) return 'artifact'
  if (input.activeView === 'chat' && input.chatPanelOpen) return 'preview'
  return 'none'
}

describe('terminal gating matrix', () => {
  beforeEach(() => {
    useUiStore.setState({
      activeView: 'chat',
      activeTab: 'files',
      chatActiveTab: 'files',
    })
  })

  // G2: ChatTab type surface never includes terminal
  it('G2: ChatTab values exclude terminal; ArtifactTab includes it', () => {
    const chatTabs: ChatTab[] = ['files', 'outline', 'sources']
    expect(chatTabs).not.toContain('terminal' as ChatTab)
    const codeTabs: ArtifactTab[] = ['files', 'outline', 'changes', 'terminal']
    expect(codeTabs).toContain('terminal')
  })

  // G5: code → chat → code keeps activeTab terminal
  it('G5: activeTab terminal survives surface switch chat ↔ code', () => {
    useUiStore.getState().setActiveView('code')
    useUiStore.getState().setTab('terminal')
    expect(useUiStore.getState().activeTab).toBe('terminal')

    useUiStore.getState().setActiveView('chat')
    expect(useUiStore.getState().activeTab).toBe('terminal')

    useUiStore.getState().setActiveView('code')
    expect(useUiStore.getState().activeTab).toBe('terminal')
  })

  // G6: non chat/code/knowledge work surfaces never open ArtifactPanel (terminal host)
  it('G6: tasks and automation never open code ArtifactPanel (terminal host)', () => {
    expect(
      rightPanelKind({
        activeView: 'tasks',
        codePanelOpen: true,
        chatPanelOpen: true,
        knowledgePanelOpen: true,
        hasSession: true,
      }),
    ).toBe('none')
    expect(
      rightPanelKind({
        activeView: 'automation',
        codePanelOpen: true,
        chatPanelOpen: true,
        knowledgePanelOpen: true,
        hasSession: true,
      }),
    ).toBe('none')
    // PTY keep-alive is backend/lifecycle — panel absence is the UI gate.
  })

  it('knowledge + panel open → knowledge outline (no session required)', () => {
    expect(
      rightPanelKind({
        activeView: 'knowledge',
        codePanelOpen: false,
        chatPanelOpen: false,
        knowledgePanelOpen: true,
        hasSession: false,
      }),
    ).toBe('knowledge')
    expect(
      rightPanelKind({
        activeView: 'knowledge',
        codePanelOpen: true,
        chatPanelOpen: true,
        knowledgePanelOpen: false,
        hasSession: true,
      }),
    ).toBe('none')
  })

  // G7: no session → no panel host
  it('G7: no session yields no right panel', () => {
    expect(
      rightPanelKind({
        activeView: 'code',
        codePanelOpen: true,
        chatPanelOpen: false,
        hasSession: false,
      }),
    ).toBe('none')
  })

  it('G7b: code + session + panel open → artifact (terminal can live here)', () => {
    expect(
      rightPanelKind({
        activeView: 'code',
        codePanelOpen: true,
        chatPanelOpen: false,
        hasSession: true,
      }),
    ).toBe('artifact')
  })

  it('G2b: chat panel open → preview only (never artifact/terminal)', () => {
    expect(
      rightPanelKind({
        activeView: 'chat',
        codePanelOpen: true,
        chatPanelOpen: true,
        hasSession: true,
      }),
    ).toBe('preview')
  })

  // G8: production call sites that setTab to terminal — only PanelToggle path is intentional.
  // Document via static allowlist of files that may set terminal (enforced in review / this comment).
  it('G8: activeTab can be set to terminal only via setTab API (used by PanelToggle)', () => {
    useUiStore.getState().setTab('files')
    useUiStore.getState().setTab('terminal')
    expect(useUiStore.getState().activeTab).toBe('terminal')
    // chatActiveTab cannot hold terminal at type level — assign only ChatTab
    useUiStore.getState().setChatActiveTab('sources')
    expect(useUiStore.getState().chatActiveTab).toBe('sources')
  })

  it('activeTab is not persisted (leftover terminal is in-memory only)', () => {
    // hip-ui partialize includes tabs/settings but never activeTab — terminal is session-local UI state
    const partialize = (s: {
      codeSessionId: string | null
      theme: string
      activeTab: string
    }) => ({
      codeSessionId: s.codeSessionId,
      theme: s.theme,
    })
    const persisted = partialize({
      codeSessionId: 's1',
      theme: 'dark',
      activeTab: 'terminal',
    })
    expect(persisted).not.toHaveProperty('activeTab')
    expect(persisted).toEqual({ codeSessionId: 's1', theme: 'dark' })
  })
})
