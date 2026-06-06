// src/store/panelLifecycle.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from './uiStore'

beforeEach(() => {
  useUiStore.setState({
    collapsed: false,
    search: '',
    panelOpen: true,
    activeTab: 'agents',
  })
})


describe('ArtifactPanel — lifecycle state transitions', () => {
  // ── Normal operation ──

  it('open panel → switch tabs → close panel', () => {
    const s = useUiStore.getState()

    s.setTab('doc')
    expect(useUiStore.getState().activeTab).toBe('doc')

    s.setTab('files')
    expect(useUiStore.getState().activeTab).toBe('files')

    s.setTab('diff')
    expect(useUiStore.getState().activeTab).toBe('diff')

    s.setTab('agents')
    expect(useUiStore.getState().activeTab).toBe('agents')

    s.togglePanel()
    expect(useUiStore.getState().panelOpen).toBe(false)
  })

  // ── setPanelOpen edge cases ──

  it('setPanelOpen(true) when already open is safe (no state change)', () => {
    useUiStore.getState().setTab('doc')
    useUiStore.getState().setPanelOpen(true)

    expect(useUiStore.getState().panelOpen).toBe(true)
    expect(useUiStore.getState().activeTab).toBe('doc')
  })

  it('setPanelOpen(false) when already closed is a no-op', () => {
    useUiStore.getState().togglePanel()
    const before = useUiStore.getState()

    useUiStore.getState().setPanelOpen(false)
    expect(useUiStore.getState()).toBe(before)
  })
})

