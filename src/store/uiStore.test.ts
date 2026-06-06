// src/store/uiStore.test.ts
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

describe('uiStore - panel state management', () => {
  it('initial state: panel is open, not fullscreen', () => {
    const s = useUiStore.getState()
    expect(s.panelOpen).toBe(true)
    expect(s.panelFullscreen).toBe(false)
  })

  // ---- panelOpen ↔ togglePanel / setPanelOpen ----

  it('togglePanel toggles panelOpen', () => {
    useUiStore.getState().togglePanel()
    expect(useUiStore.getState().panelOpen).toBe(false)

    useUiStore.getState().togglePanel()
    expect(useUiStore.getState().panelOpen).toBe(true)
  })

  it('setPanelOpen(true) opens panel', () => {
    useUiStore.getState().setPanelOpen(false)
    expect(useUiStore.getState().panelOpen).toBe(false)

    useUiStore.getState().setPanelOpen(true)
    expect(useUiStore.getState().panelOpen).toBe(true)
  })

  // ---- panelFullscreen ↔ toggleFullscreen ----

  it('toggleFullscreen toggles panelFullscreen', () => {
    useUiStore.getState().toggleFullscreen()
    expect(useUiStore.getState().panelFullscreen).toBe(true)

    useUiStore.getState().toggleFullscreen()
    expect(useUiStore.getState().panelFullscreen).toBe(false)
  })

  // ---- BUG: closing panel while fullscreen leaves stale fullscreen state ----

  it('closing panel while fullscreen resets panelFullscreen to false', () => {
    // Enter fullscreen
    useUiStore.getState().toggleFullscreen()
    expect(useUiStore.getState().panelFullscreen).toBe(true)
    expect(useUiStore.getState().panelOpen).toBe(true)

    // Close panel via togglePanel — fullscreen MUST reset
    useUiStore.getState().togglePanel()
    expect(useUiStore.getState().panelOpen).toBe(false)
    expect(useUiStore.getState().panelFullscreen).toBe(false)
  })

  it('closing panel via setPanelOpen(false) while fullscreen resets fullscreen', () => {
    useUiStore.getState().toggleFullscreen()
    expect(useUiStore.getState().panelFullscreen).toBe(true)

    useUiStore.getState().setPanelOpen(false)
    expect(useUiStore.getState().panelOpen).toBe(false)
    expect(useUiStore.getState().panelFullscreen).toBe(false)
  })

  it('reopening panel after close-from-fullscreen starts in normal mode', () => {
    // Fullscreen → close → reopen
    useUiStore.getState().toggleFullscreen()
    useUiStore.getState().togglePanel()
    useUiStore.getState().togglePanel()

    // Should be open, not fullscreen
    expect(useUiStore.getState().panelOpen).toBe(true)
    expect(useUiStore.getState().panelFullscreen).toBe(false)
  })

  // ---- setPanelOpen with zero-width panel (collapsing the react-resizable-panel) ----

  it('setPanelOpen to same value is a no-op (optimistic guard)', () => {
    const before = useUiStore.getState()
    useUiStore.getState().setPanelOpen(true)
    expect(useUiStore.getState()).toBe(before) // same reference
  })

  // ---- activeTab switching ----

  it('setTab switches active tab', () => {
    useUiStore.getState().setTab('doc')
    expect(useUiStore.getState().activeTab).toBe('doc')

    useUiStore.getState().setTab('files')
    expect(useUiStore.getState().activeTab).toBe('files')

    useUiStore.getState().setTab('diff')
    expect(useUiStore.getState().activeTab).toBe('diff')
  })

  // ---- Fullscreen does not affect activeTab ----

  it('fullscreen preserves active tab', () => {
    useUiStore.getState().setTab('doc')
    useUiStore.getState().toggleFullscreen()
    expect(useUiStore.getState().activeTab).toBe('doc')
    expect(useUiStore.getState().panelFullscreen).toBe(true)
  })
})
