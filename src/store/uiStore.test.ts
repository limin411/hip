// src/store/uiStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from './uiStore'

beforeEach(() => {
  useUiStore.setState({
    collapsed: false,
    search: '',
    panelOpen: false,
    activeTab: 'agents',
  })
})

describe('uiStore - panel state management', () => {
  it('initial state: panel is closed', () => {
    const s = useUiStore.getState()
    expect(s.panelOpen).toBe(false)
  })

  // ---- panelOpen ↔ togglePanel / setPanelOpen ----

  it('togglePanel toggles panelOpen', () => {
    useUiStore.getState().togglePanel()
    expect(useUiStore.getState().panelOpen).toBe(true)

    useUiStore.getState().togglePanel()
    expect(useUiStore.getState().panelOpen).toBe(false)
  })

  it('setPanelOpen(true) opens panel', () => {
    useUiStore.getState().setPanelOpen(false)
    expect(useUiStore.getState().panelOpen).toBe(false)

    useUiStore.getState().setPanelOpen(true)
    expect(useUiStore.getState().panelOpen).toBe(true)
  })

  // ---- setPanelOpen with zero-width panel (collapsing the react-resizable-panel) ----

  it('setPanelOpen to same value is a no-op (optimistic guard)', () => {
    const before = useUiStore.getState()
    useUiStore.getState().setPanelOpen(false)
    expect(useUiStore.getState()).toBe(before) // same reference
  })

  // ---- activeTab switching ----

  it('setTab switches active tab', () => {
    useUiStore.getState().setTab('files')
    expect(useUiStore.getState().activeTab).toBe('files')

    useUiStore.getState().setTab('files')
    expect(useUiStore.getState().activeTab).toBe('files')

    useUiStore.getState().setTab('diff')
    expect(useUiStore.getState().activeTab).toBe('diff')
  })
})
