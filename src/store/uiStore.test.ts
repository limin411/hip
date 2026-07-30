// src/store/uiStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { WORK_ITEM_TRACKING } from '@/components/work-items/feature'
import { AUTOMATION_PAGE } from '@/components/automation/feature'
import {
  useUiStore,
  normalizeAppLanguage,
  normalizeUiDensity,
  isUiDensity,
  isEphemeralActiveView,
  isPlaceholderSidebarSection,
  mergeUiPersistedState,
  applyColdLaunchShell,
  type UiPersistedState,
} from './uiStore'

beforeEach(() => {
  useUiStore.setState({
    activeTab: 'agents',
    theme: 'system',
    language: 'zh-CN',
    density: 'comfortable',
    chatSessionId: null,
    codeSessionId: null,
    activeView: 'chat',
    settingsPage: 'general',
    diffViewMode: 'unified',
    checkpointMode: 'this-turn',
    overlay: null,
    settingsShellRoute: { type: 'page' },
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

    useUiStore.getState().setActiveView('trash')
    expect(useUiStore.getState().activeView).toBe('trash')
    expect(useUiStore.getState().previousView).toBe('code')

    useUiStore.getState().setActiveView('chat')
    expect(useUiStore.getState().previousView).toBeNull()
  })

  it('treats trash as ephemeral special view', () => {
    expect(isEphemeralActiveView('trash')).toBe(true)
    useUiStore.setState({ activeView: 'chat', previousView: null })
    useUiStore.getState().setActiveView('trash')
    expect(useUiStore.getState().previousView).toBe('chat')
  })

  it('setActiveView to the same value is a no-op (same reference)', () => {
    useUiStore.getState().setActiveView('chat')
    const before = useUiStore.getState()
    useUiStore.getState().setActiveView('chat')
    expect(useUiStore.getState()).toBe(before)
  })
})

describe('uiStore - overlay', () => {
  it('defaults to null', () => {
    expect(useUiStore.getState().overlay).toBeNull()
  })

  it('setOverlay opens and closes without changing activeView', () => {
    useUiStore.setState({ activeView: 'chat', sidebarSection: 'chats' })
    useUiStore.getState().setOverlay('history')
    expect(useUiStore.getState().overlay).toBe('history')
    expect(useUiStore.getState().activeView).toBe('chat')
    useUiStore.getState().setOverlay(null)
    expect(useUiStore.getState().overlay).toBeNull()
    expect(useUiStore.getState().activeView).toBe('chat')
  })

  it('settingsShellRoute defaults to page and resets when overlay leaves settings', () => {
    expect(useUiStore.getState().settingsShellRoute).toEqual({ type: 'page' })
    useUiStore.getState().setOverlay('settings')
    useUiStore.getState().setSettingsShellRoute({ type: 'agent-edit', kind: 'internal' })
    expect(useUiStore.getState().settingsShellRoute.type).toBe('agent-edit')
    useUiStore.getState().setOverlay(null)
    expect(useUiStore.getState().settingsShellRoute).toEqual({ type: 'page' })
  })

  it('setSettingsPage pops L2 route when category changes', () => {
    useUiStore.getState().setSettingsPage('agents')
    useUiStore.getState().setSettingsShellRoute({ type: 'agent-edit', agentId: 'a1' })
    useUiStore.getState().setSettingsPage('mcp')
    expect(useUiStore.getState().settingsShellRoute).toEqual({ type: 'page' })
    expect(useUiStore.getState().settingsPage).toBe('mcp')
  })

  it('toggleOverlay opens then closes', () => {
    useUiStore.getState().toggleOverlay('trash')
    expect(useUiStore.getState().overlay).toBe('trash')
    useUiStore.getState().toggleOverlay('trash')
    expect(useUiStore.getState().overlay).toBeNull()
  })

  it('toggleOverlay switches between kinds', () => {
    useUiStore.getState().setOverlay('history')
    useUiStore.getState().toggleOverlay('trash')
    expect(useUiStore.getState().overlay).toBe('trash')
  })

  it('setOverlay coerces residual special activeView to work surface', () => {
    useUiStore.setState({
      activeView: 'history',
      sidebarSection: 'chats',
      chatSessionId: null,
      codeSessionId: null,
      overlay: null,
    })
    useUiStore.getState().setOverlay('trash')
    expect(useUiStore.getState().overlay).toBe('trash')
    // No session → chat home
    expect(useUiStore.getState().activeView).toBe('chat')
    expect(useUiStore.getState().sidebarSection).toBe('chats')
  })

  it('overlay is not in partialize / UiPersistedState shape', () => {
    useUiStore.getState().setOverlay('history')
    const s = useUiStore.getState()
    // Mirror the store partialize projection (runtime omit of overlay).
    const persisted: UiPersistedState = {
      chatSessionId: s.chatSessionId,
      codeSessionId: s.codeSessionId,
      theme: s.theme,
      language: s.language,
      density: s.density,
      settingsPage: s.settingsPage,
      diffViewMode: s.diffViewMode,
      checkpointMode: s.checkpointMode,
      sidebarOpen: s.sidebarOpen,
      sidebarWidth: s.sidebarWidth,
    }
    expect(persisted).not.toHaveProperty('overlay')
    expect(s.overlay).toBe('history')
    applyColdLaunchShell()
    expect(useUiStore.getState().overlay).toBeNull()
    expect(useUiStore.getState().activeView).toBe('chat')
  })

  it('setActiveView(settings) does not clear overlay (settings is overlay-only path)', () => {
    // Residual setActiveView('settings') no longer dismisses utility shells (PR4).
    useUiStore.setState({ activeView: 'chat', overlay: 'trash' })
    useUiStore.getState().setActiveView('settings')
    expect(useUiStore.getState().activeView).toBe('settings')
    expect(useUiStore.getState().overlay).toBe('trash')
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

    useUiStore.getState().setLanguage('ja')
    expect(useUiStore.getState().language).toBe('ja')

    useUiStore.getState().setLanguage('ko')
    expect(useUiStore.getState().language).toBe('ko')
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
    expect(normalizeAppLanguage('ja')).toBe('ja')
    expect(normalizeAppLanguage('ja-JP')).toBe('ja')
    expect(normalizeAppLanguage('ko')).toBe('ko')
    expect(normalizeAppLanguage('ko-KR')).toBe('ko')
    expect(normalizeAppLanguage('fr')).toBeNull()
  })
})

describe('uiStore - density', () => {
  it('defaults to comfortable', () => {
    expect(useUiStore.getState().density).toBe('comfortable')
  })

  it('setDensity switches between comfortable and compact', () => {
    useUiStore.getState().setDensity('compact')
    expect(useUiStore.getState().density).toBe('compact')

    useUiStore.getState().setDensity('comfortable')
    expect(useUiStore.getState().density).toBe('comfortable')
  })

  it('setDensity to the same value is a no-op (same reference)', () => {
    useUiStore.getState().setDensity('comfortable')
    const before = useUiStore.getState()
    useUiStore.getState().setDensity('comfortable')
    expect(useUiStore.getState()).toBe(before)
  })
})

describe('isUiDensity / normalizeUiDensity', () => {
  it('isUiDensity accepts only comfortable | compact', () => {
    expect(isUiDensity('comfortable')).toBe(true)
    expect(isUiDensity('compact')).toBe(true)
    expect(isUiDensity('cozy')).toBe(false)
    expect(isUiDensity('')).toBe(false)
    expect(isUiDensity(null)).toBe(false)
    expect(isUiDensity(undefined)).toBe(false)
    expect(isUiDensity(1)).toBe(false)
  })

  it('normalizeUiDensity maps invalid values to comfortable', () => {
    expect(normalizeUiDensity('comfortable')).toBe('comfortable')
    expect(normalizeUiDensity('compact')).toBe('compact')
    expect(normalizeUiDensity(undefined)).toBe('comfortable')
    expect(normalizeUiDensity(null)).toBe('comfortable')
    expect(normalizeUiDensity('cozy')).toBe('comfortable')
    expect(normalizeUiDensity(42)).toBe('comfortable')
  })
})

describe('uiStore persistence partialize', () => {
  it('includes surface pointers and settings (not activeView / open tabs)', () => {
    useUiStore.setState({
      chatSessionId: 'a',
      codeSessionId: 'c',
      activeView: 'code',
      theme: 'dark',
      language: 'en',
      density: 'compact',
      settingsPage: 'model',
      diffViewMode: 'split',
      checkpointMode: 'since-start',
      activeTab: 'terminal',
      scrollTargetMessageId: 'm1',
      selectedArtifactPath: '/x',
    })
    const s = useUiStore.getState()
    const persisted: UiPersistedState = {
      chatSessionId: s.chatSessionId,
      codeSessionId: s.codeSessionId,
      theme: s.theme,
      language: s.language,
      density: s.density,
      settingsPage: s.settingsPage,
      diffViewMode: s.diffViewMode,
      checkpointMode: s.checkpointMode,
      sidebarOpen: s.sidebarOpen,
      sidebarWidth: s.sidebarWidth,
    }
    expect(persisted).toEqual({
      chatSessionId: 'a',
      codeSessionId: 'c',
      theme: 'dark',
      language: 'en',
      density: 'compact',
      settingsPage: 'model',
      diffViewMode: 'split',
      checkpointMode: 'since-start',
      sidebarOpen: s.sidebarOpen,
      sidebarWidth: s.sidebarWidth,
    })
    expect(persisted).not.toHaveProperty('activeTab')
    expect(persisted).not.toHaveProperty('scrollTargetMessageId')
    expect(persisted).not.toHaveProperty('activeView')
    expect(persisted).not.toHaveProperty('openSessionIds')
    expect(persisted).not.toHaveProperty('overlay')
  })

  it('merge strips legacy activeView / tabs / knowledge so cold launch stays on chats', () => {
    expect(isEphemeralActiveView('knowledge')).toBe(true)

    const current = {
      activeView: 'chat' as const,
      sidebarSection: 'chats' as const,
      theme: 'system' as const,
      density: 'comfortable' as const,
    }
    const merged = mergeUiPersistedState(
      {
        openSessionIds: ['s1'],
        activeView: 'knowledge',
        knowledgeTabOpen: true,
        sidebarSection: 'projects',
        theme: 'dark',
        density: 'compact',
      },
      current,
    )
    expect(merged.activeView).toBe('chat')
    expect(merged.sidebarSection).toBe('chats')
    expect(merged).not.toHaveProperty('openSessionIds')
    expect(merged).not.toHaveProperty('knowledgeTabOpen')
    expect(merged.theme).toBe('dark')
    expect(merged.density).toBe('compact')
  })

  it('merge normalizes invalid density to comfortable', () => {
    const current = {
      activeView: 'chat' as const,
      sidebarSection: 'chats' as const,
      density: 'compact' as const,
    }
    const merged = mergeUiPersistedState(
      { density: 'cozy' },
      current,
    )
    expect(merged.density).toBe('comfortable')
  })

  it('merge treats missing density as comfortable', () => {
    const current = {
      activeView: 'chat' as const,
      sidebarSection: 'chats' as const,
      density: 'compact' as const,
    }
    const merged = mergeUiPersistedState(
      { theme: 'dark' },
      current,
    )
    expect(merged.density).toBe('comfortable')
  })

  it('applyColdLaunchShell forces chats section', () => {
    useUiStore.setState({
      activeView: 'knowledge',
      sidebarSection: 'knowledge',
    })
    applyColdLaunchShell()
    expect(useUiStore.getState().activeView).toBe('chat')
    expect(useUiStore.getState().sidebarSection).toBe('chats')
  })

  it('merge clamps invalid sidebarWidth', () => {
    const current = {
      activeView: 'chat' as const,
      sidebarSection: 'chats' as const,
      sidebarWidth: 300,
    }
    expect(mergeUiPersistedState({ sidebarWidth: 9999 }, current).sidebarWidth).toBe(480)
    expect(mergeUiPersistedState({ sidebarWidth: 50 }, current).sidebarWidth).toBe(200)
    expect(mergeUiPersistedState({ sidebarWidth: 'wide' }, current).sidebarWidth).toBe(300)
  })
})

describe('uiStore - sidebarWidth', () => {
  it('defaults to 300 and clamps via setSidebarWidth', () => {
    useUiStore.setState({ sidebarWidth: 300 })
    expect(useUiStore.getState().sidebarWidth).toBe(300)
    useUiStore.getState().setSidebarWidth(320)
    expect(useUiStore.getState().sidebarWidth).toBe(320)
    useUiStore.getState().setSidebarWidth(10)
    expect(useUiStore.getState().sidebarWidth).toBe(200)
    useUiStore.getState().setSidebarWidth(900)
    expect(useUiStore.getState().sidebarWidth).toBe(480)
  })
})

describe('uiStore - isPlaceholderSidebarSection (work items / automation flags)', () => {
  it('excludes tasks and automation from placeholder when flags are true', () => {
    expect(WORK_ITEM_TRACKING).toBe(true)
    expect(AUTOMATION_PAGE).toBe(true)
    expect(isPlaceholderSidebarSection('tasks')).toBe(false)
    expect(isPlaceholderSidebarSection('automation')).toBe(false)
    // Real sections
    expect(isPlaceholderSidebarSection('chats')).toBe(false)
    expect(isPlaceholderSidebarSection('projects')).toBe(false)
    expect(isPlaceholderSidebarSection('knowledge')).toBe(false)
  })
})
