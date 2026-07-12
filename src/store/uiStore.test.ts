// src/store/uiStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore, normalizeAppLanguage, type UiPersistedState } from './uiStore'

beforeEach(() => {
  useUiStore.setState({
    settingsNavCollapsed: false,
    activeTab: 'agents',
    theme: 'system',
    language: 'zh-CN',
    openSessionIds: [],
    chatSessionId: null,
    codeSessionId: null,
    activeView: 'chat',
    settingsPage: 'general',
    diffViewMode: 'unified',
    checkpointMode: 'this-turn',
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

  it('remembers previousView when entering history from code', () => {
    useUiStore.setState({ activeView: 'code', previousView: null })
    useUiStore.getState().setActiveView('history')
    expect(useUiStore.getState().previousView).toBe('code')
  })

  it('remembers previousView when entering settings from chat', () => {
    useUiStore.setState({ activeView: 'chat', previousView: null })
    useUiStore.getState().setActiveView('settings')
    expect(useUiStore.getState().previousView).toBe('chat')
  })

  it('clears previousView when leaving history to chat', () => {
    useUiStore.setState({ activeView: 'chat', previousView: null })
    useUiStore.getState().setActiveView('history')
    expect(useUiStore.getState().previousView).toBe('chat')

    useUiStore.getState().setActiveView('chat')
    expect(useUiStore.getState().previousView).toBeNull()
  })

  it('clears previousView when leaving settings to code', () => {
    useUiStore.setState({ activeView: 'code', previousView: null })
    useUiStore.getState().setActiveView('settings')
    expect(useUiStore.getState().previousView).toBe('code')

    useUiStore.getState().setActiveView('code')
    expect(useUiStore.getState().previousView).toBeNull()
  })

  it('preserves the original non-special previousView when switching between special views', () => {
    useUiStore.setState({ activeView: 'code', previousView: null })
    useUiStore.getState().setActiveView('settings')
    expect(useUiStore.getState().previousView).toBe('code')

    useUiStore.getState().setActiveView('history')
    expect(useUiStore.getState().activeView).toBe('history')
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
  beforeEach(() => useUiStore.setState({ activeView: 'chat', selectedArtifactPath: null, chatSessionId: null, codeSessionId: null }))

  it('setActiveView accepts code', () => {
    useUiStore.getState().setActiveView('code')
    expect(useUiStore.getState().activeView).toBe('code')
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

  it('accepts terminal as a code ArtifactTab', () => {
    useUiStore.getState().setTab('terminal')
    expect(useUiStore.getState().activeTab).toBe('terminal')
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

describe('uiStore - language', () => {
  it('setLanguage switches locales', () => {
    useUiStore.getState().setLanguage('en')
    expect(useUiStore.getState().language).toBe('en')

    useUiStore.getState().setLanguage('zh-TW')
    expect(useUiStore.getState().language).toBe('zh-TW')
  })

  it('setLanguage to the same value is a no-op', () => {
    useUiStore.getState().setLanguage('zh-CN')
    const before = useUiStore.getState()
    useUiStore.getState().setLanguage('zh-CN')
    expect(useUiStore.getState()).toBe(before)
  })
})

describe('normalizeAppLanguage', () => {
  it('maps browser tags onto app locales', () => {
    expect(normalizeAppLanguage('zh-CN')).toBe('zh-CN')
    expect(normalizeAppLanguage('zh-TW')).toBe('zh-TW')
    expect(normalizeAppLanguage('en')).toBe('en')
    expect(normalizeAppLanguage('en-US')).toBe('en')
    expect(normalizeAppLanguage('zh-HK')).toBe('zh-TW')
    expect(normalizeAppLanguage('zh')).toBe('zh-CN')
    expect(normalizeAppLanguage('fr')).toBeNull()
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

  it('moves an existing id to the front when re-added', () => {
    useUiStore.getState().addOpenSession('s1')
    useUiStore.getState().addOpenSession('s2')
    useUiStore.getState().addOpenSession('s1')
    expect(useUiStore.getState().openSessionIds).toEqual(['s1', 's2'])
  })
})

describe('uiStore persistence partialize', () => {
  it('includes open tabs, surface pointers, and settings (not ephemeral UI)', () => {
    useUiStore.setState({
      openSessionIds: ['a', 'b'],
      chatSessionId: 'a',
      codeSessionId: 'c',
      activeView: 'code',
      theme: 'dark',
      language: 'en',
      settingsPage: 'model',
      settingsNavCollapsed: true,
      diffViewMode: 'split',
      checkpointMode: 'since-start',
      activeTab: 'terminal',
      scrollTargetMessageId: 'm1',
      selectedArtifactPath: '/x',
    })
    const s = useUiStore.getState()
    const persisted: UiPersistedState = {
      openSessionIds: s.openSessionIds,
      chatSessionId: s.chatSessionId,
      codeSessionId: s.codeSessionId,
      activeView: s.activeView,
      theme: s.theme,
      language: s.language,
      settingsPage: s.settingsPage,
      settingsNavCollapsed: s.settingsNavCollapsed,
      diffViewMode: s.diffViewMode,
      checkpointMode: s.checkpointMode,
    }
    expect(persisted).toEqual({
      openSessionIds: ['a', 'b'],
      chatSessionId: 'a',
      codeSessionId: 'c',
      activeView: 'code',
      theme: 'dark',
      language: 'en',
      settingsPage: 'model',
      settingsNavCollapsed: true,
      diffViewMode: 'split',
      checkpointMode: 'since-start',
    })
    expect(persisted).not.toHaveProperty('activeTab')
    expect(persisted).not.toHaveProperty('scrollTargetMessageId')
  })
})
