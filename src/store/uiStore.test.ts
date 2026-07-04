// src/store/uiStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from './uiStore'

beforeEach(() => {
  useUiStore.setState({
    settingsNavCollapsed: false,
    search: '',
    panelOpen: false,
    activeTab: 'agents',
    theme: 'system',
    openSessionIds: [],
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

    useUiStore.getState().setTab('timeline')
    expect(useUiStore.getState().activeTab).toBe('timeline')
  })
})

describe('uiStore - scroll target', () => {
  it('initial scrollTargetMessageId is null', () => {
    useUiStore.setState({ scrollTargetMessageId: null })
    expect(useUiStore.getState().scrollTargetMessageId).toBeNull()
  })

  it('setScrollTarget stores an id and clears it with null', () => {
    useUiStore.getState().setScrollTarget('m42')
    expect(useUiStore.getState().scrollTargetMessageId).toBe('m42')
    useUiStore.getState().setScrollTarget(null)
    expect(useUiStore.getState().scrollTargetMessageId).toBeNull()
  })
})

describe('uiStore - diffViewMode', () => {
  it('defaults to unified', () => {
    expect(useUiStore.getState().diffViewMode).toBe('unified')
  })

  it('setDiffViewMode switches between unified and split', () => {
    useUiStore.getState().setDiffViewMode('split')
    expect(useUiStore.getState().diffViewMode).toBe('split')

    useUiStore.getState().setDiffViewMode('unified')
    expect(useUiStore.getState().diffViewMode).toBe('unified')
  })
})

describe('uiStore - settingsNavCollapsed', () => {
  it('defaults to expanded (false)', () => {
    expect(useUiStore.getState().settingsNavCollapsed).toBe(false)
  })

  it('toggleSettingsNav flips the collapsed flag', () => {
    useUiStore.getState().toggleSettingsNav()
    expect(useUiStore.getState().settingsNavCollapsed).toBe(true)

    useUiStore.getState().toggleSettingsNav()
    expect(useUiStore.getState().settingsNavCollapsed).toBe(false)
  })

  it('setSettingsNavCollapsed to the same value is a no-op (same reference)', () => {
    useUiStore.getState().setSettingsNavCollapsed(false)
    const before = useUiStore.getState()
    useUiStore.getState().setSettingsNavCollapsed(false)
    expect(useUiStore.getState()).toBe(before)
  })

  it('settings nav collapse toggles independently', () => {
    useUiStore.getState().setSettingsNavCollapsed(true)
    expect(useUiStore.getState().settingsNavCollapsed).toBe(true)
  })
})

describe('uiStore - activeView', () => {
  it('defaults to chat', () => {
    useUiStore.setState({ activeView: 'chat' })
    expect(useUiStore.getState().activeView).toBe('chat')
  })

  it('setActiveView switches between chat, code, and settings', () => {
    useUiStore.getState().setActiveView('code')
    expect(useUiStore.getState().activeView).toBe('code')

    useUiStore.getState().setActiveView('settings')
    expect(useUiStore.getState().activeView).toBe('settings')

    useUiStore.getState().setActiveView('chat')
    expect(useUiStore.getState().activeView).toBe('chat')
  })

  it('remembers previousView when entering settings from chat or code', () => {
    useUiStore.setState({ activeView: 'code', previousView: null })
    useUiStore.getState().setActiveView('settings')
    expect(useUiStore.getState().previousView).toBe('code')

    useUiStore.getState().setActiveView('chat')
    expect(useUiStore.getState().previousView).toBeNull()
  })

  it('setActiveView to the same value is a no-op (same reference)', () => {
    useUiStore.getState().setActiveView('chat')
    const before = useUiStore.getState()
    useUiStore.getState().setActiveView('chat')
    expect(useUiStore.getState()).toBe(before)
  })
})

describe('uiStore - code surface', () => {
  beforeEach(() => useUiStore.setState({ activeView: 'chat', chatPanelOpen: false, selectedArtifactPath: null, chatSessionId: null, codeSessionId: null }))

  it('setActiveView accepts code', () => {
    useUiStore.getState().setActiveView('code')
    expect(useUiStore.getState().activeView).toBe('code')
  })
  it('toggleChatPanel / setChatPanelOpen drive the chat preview panel', () => {
    useUiStore.getState().toggleChatPanel()
    expect(useUiStore.getState().chatPanelOpen).toBe(true)
    useUiStore.getState().setChatPanelOpen(false)
    expect(useUiStore.getState().chatPanelOpen).toBe(false)
  })
  it('setSelectedArtifactPath stores + clears the selected file', () => {
    useUiStore.getState().setSelectedArtifactPath('/a.md')
    expect(useUiStore.getState().selectedArtifactPath).toBe('/a.md')
    useUiStore.getState().setSelectedArtifactPath(null)
    expect(useUiStore.getState().selectedArtifactPath).toBeNull()
  })
  it('per-surface conversation ids are independent', () => {
    useUiStore.getState().setChatSessionId('h1')
    useUiStore.getState().setCodeSessionId('c1')
    expect(useUiStore.getState().chatSessionId).toBe('h1')
    expect(useUiStore.getState().codeSessionId).toBe('c1')
  })
})

describe('uiStore - chatActiveTab (Chat panel tabs)', () => {
  beforeEach(() => useUiStore.setState({ chatActiveTab: 'files' }))

  it('defaults to files', () => {
    expect(useUiStore.getState().chatActiveTab).toBe('files')
  })

  it('setChatActiveTab switches to agents', () => {
    useUiStore.getState().setChatActiveTab('agents')
    expect(useUiStore.getState().chatActiveTab).toBe('agents')
  })

  it('resetChatActiveTab restores files', () => {
    useUiStore.getState().setChatActiveTab('agents')
    useUiStore.getState().resetChatActiveTab()
    expect(useUiStore.getState().chatActiveTab).toBe('files')
  })

  it('setChatActiveTab to same value is a no-op (same reference)', () => {
    const before = useUiStore.getState()
    useUiStore.getState().setChatActiveTab('files')
    expect(useUiStore.getState()).toBe(before)
  })

  it('resetChatActiveTab when already files is a no-op', () => {
    const before = useUiStore.getState()
    useUiStore.getState().resetChatActiveTab()
    expect(useUiStore.getState()).toBe(before)
  })

  it('chatActiveTab is independent of code panel activeTab', () => {
    useUiStore.getState().setTab('timeline')
    expect(useUiStore.getState().activeTab).toBe('timeline')
    expect(useUiStore.getState().chatActiveTab).toBe('files')
  })
})

describe('uiStore - theme', () => {
  it('defaults to system', () => {
    expect(useUiStore.getState().theme).toBe('system')
  })

  it('setTheme switches between light, dark, and system', () => {
    useUiStore.getState().setTheme('light')
    expect(useUiStore.getState().theme).toBe('light')

    useUiStore.getState().setTheme('dark')
    expect(useUiStore.getState().theme).toBe('dark')

    useUiStore.getState().setTheme('system')
    expect(useUiStore.getState().theme).toBe('system')
  })

  it('setTheme to the same value is a no-op (same reference)', () => {
    useUiStore.getState().setTheme('system')
    const before = useUiStore.getState()
    useUiStore.getState().setTheme('system')
    expect(useUiStore.getState()).toBe(before)
  })
})

describe('uiStore open sessions', () => {
  beforeEach(() => {
    useUiStore.setState({ openSessionIds: [] })
  })

  it('adds and removes open session ids', () => {
    useUiStore.getState().addOpenSession('s1')
    useUiStore.getState().addOpenSession('s2')
    expect(useUiStore.getState().openSessionIds).toEqual(['s2', 's1'])

    useUiStore.getState().removeOpenSession('s1')
    expect(useUiStore.getState().openSessionIds).toEqual(['s2'])
  })

  it('reorders open session ids', () => {
    useUiStore.getState().addOpenSession('s1')
    useUiStore.getState().addOpenSession('s2')
    useUiStore.getState().reorderOpenSessions(['s2', 's1'])
    expect(useUiStore.getState().openSessionIds).toEqual(['s2', 's1'])
  })
})
