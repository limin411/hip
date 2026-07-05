// src/store/panelLifecycle.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useDomainStore } from '@/domain/sessionStore'
import { useUiStore } from './uiStore'

function reset() {
  useDomainStore.setState({ sessions: [], activeSessionId: null, connection: 'disconnected' })
}

describe('Session-scoped panel lifecycle', () => {
  beforeEach(reset)

  it('open panel → switch tabs → close panel on the active session', () => {
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    const ui = useUiStore.getState()

    ui.setTab('files')
    expect(useUiStore.getState().activeTab).toBe('files')

    useDomainStore.getState().setSessionCodePanelOpen('s1', true)
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(true)

    useDomainStore.getState().toggleSessionCodePanel('s1')
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(false)
  })

  it('setSessionCodePanelOpen(true) when already open is safe', () => {
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().setSessionCodePanelOpen('s1', true)
    useUiStore.getState().setTab('files')

    useDomainStore.getState().setSessionCodePanelOpen('s1', true)
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(true)
    expect(useUiStore.getState().activeTab).toBe('files')
  })

  it('open chat panel → toggle chat panel on the active session', () => {
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })

    useDomainStore.getState().setSessionChatPanelOpen('s1', true)
    expect(useDomainStore.getState().sessions[0].chatPanelOpen).toBe(true)

    useDomainStore.getState().toggleSessionChatPanel('s1')
    expect(useDomainStore.getState().sessions[0].chatPanelOpen).toBe(false)
  })

  it('setSessionCodePanelOpen(false) when already closed is a no-op (same reference)', () => {
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().toggleSessionCodePanel('s1')
    useDomainStore.getState().toggleSessionCodePanel('s1')
    const before = useDomainStore.getState().sessions[0]

    useDomainStore.getState().setSessionCodePanelOpen('s1', false)
    expect(useDomainStore.getState().sessions[0]).toBe(before)
  })

  it('panel state is isolated between sessions', () => {
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().createSession('s2', { llmProvider: 'deepseek', model: 'm', tools: [] })

    useDomainStore.getState().setSessionCodePanelOpen('s1', true)
    useDomainStore.getState().setSessionChatPanelOpen('s2', true)

    const s1 = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
    const s2 = useDomainStore.getState().sessions.find((s) => s.id === 's2')!

    expect(s1.codePanelOpen).toBe(true)
    expect(s1.chatPanelOpen).toBe(false)
    expect(s2.codePanelOpen).toBe(false)
    expect(s2.chatPanelOpen).toBe(true)
  })
})
