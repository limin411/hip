// src/store/panelLifecycle.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from './uiStore'

beforeEach(() => {
  useUiStore.setState({
    collapsed: false,
    search: '',
    panelOpen: true,
    panelFullscreen: false,
    activeTab: 'agents',
  })
})

describe('ArtifactPanel — full lifecycle state transitions', () => {
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

  // ── Fullscreen cycle ──

  it('fullscreen → exit fullscreen → stays open', () => {
    useUiStore.getState().toggleFullscreen()
    expect(useUiStore.getState().panelFullscreen).toBe(true)
    expect(useUiStore.getState().panelOpen).toBe(true)

    useUiStore.getState().toggleFullscreen()
    expect(useUiStore.getState().panelFullscreen).toBe(false)
    expect(useUiStore.getState().panelOpen).toBe(true)
  })

  // ── Close from fullscreen (the bug scenario) ──

  it('fullscreen → close panel → reopen → normal (not fullscreen)', () => {
    useUiStore.getState().toggleFullscreen()
    expect(useUiStore.getState().panelFullscreen).toBe(true)

    useUiStore.getState().togglePanel()
    expect(useUiStore.getState().panelOpen).toBe(false)
    expect(useUiStore.getState().panelFullscreen).toBe(false)

    useUiStore.getState().togglePanel()
    expect(useUiStore.getState().panelOpen).toBe(true)
    expect(useUiStore.getState().panelFullscreen).toBe(false)
  })

  // ── Tab switching during fullscreen ──

  it('fullscreen → switch tabs → exit fullscreen → tab preserved', () => {
    useUiStore.getState().toggleFullscreen()
    useUiStore.getState().setTab('doc')
    expect(useUiStore.getState().activeTab).toBe('doc')

    useUiStore.getState().toggleFullscreen()
    expect(useUiStore.getState().activeTab).toBe('doc')
    expect(useUiStore.getState().panelFullscreen).toBe(false)
  })

  // ── setPanelOpen edge cases ──

  it('setPanelOpen(false) while fullscreen resets fullscreen', () => {
    useUiStore.getState().toggleFullscreen()
    useUiStore.getState().setPanelOpen(false)

    expect(useUiStore.getState().panelOpen).toBe(false)
    expect(useUiStore.getState().panelFullscreen).toBe(false)
  })

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

  // ── Fullscreen + tab combinations ──

  it('sequential fullscreen toggles preserve tab', () => {
    useUiStore.getState().setTab('files')

    useUiStore.getState().toggleFullscreen()
    expect(useUiStore.getState().activeTab).toBe('files')

    useUiStore.getState().toggleFullscreen()
    expect(useUiStore.getState().activeTab).toBe('files')

    useUiStore.getState().toggleFullscreen()
    expect(useUiStore.getState().activeTab).toBe('files')
  })

  // ── Rapid toggles ──

  it('rapid togglePanel → toggleFullscreen → togglePanel is consistent', () => {
    useUiStore.getState().togglePanel()
    expect(useUiStore.getState().panelOpen).toBe(false)
    expect(useUiStore.getState().panelFullscreen).toBe(false)

    // toggleFullscreen while panel is closed (programmatic edge case)
    useUiStore.getState().toggleFullscreen()
    expect(useUiStore.getState().panelFullscreen).toBe(true)
    expect(useUiStore.getState().panelOpen).toBe(false)

    useUiStore.getState().togglePanel()
    expect(useUiStore.getState().panelOpen).toBe(true)
    // fullscreen was set while closed; opening preserves it
    expect(useUiStore.getState().panelFullscreen).toBe(true)
  })

  // ── Close via collapse (react-resizable-panels onCollapse) ──

  it('panel collapse while fullscreen resets fullscreen', () => {
    useUiStore.getState().toggleFullscreen()

    // onCollapse → setPanelOpen(false)
    useUiStore.getState().setPanelOpen(false)
    expect(useUiStore.getState().panelOpen).toBe(false)
    expect(useUiStore.getState().panelFullscreen).toBe(false)
  })
})
