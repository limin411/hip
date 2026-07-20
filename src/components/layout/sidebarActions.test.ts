// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'

const flushSave = vi.fn(async () => true)
const openSpace = vi.fn(async (_id: string) => {})
const setSurface = vi.fn((_view: 'chat' | 'code') => {})
const selectSession = vi.fn((_id: string) => {})
const newConversation = vi.fn((_surface?: 'chat' | 'code') => {})

const knowledgeState = {
  spaces: [] as { id: string; name: string }[],
  mode: 'home' as 'home' | 'workspace',
  activeSpaceId: null as string | null,
  flushSave: () => flushSave(),
  loadSpaces: vi.fn(async () => {}),
  openSpace: (id: string) => openSpace(id),
}

vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: {
    getState: () => knowledgeState,
  },
}))

vi.mock('@/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain')>()
  return {
    ...actual,
    sessionService: {
      setSurface: (view: 'chat' | 'code') => setSurface(view),
      selectSession: (id: string) => selectSession(id),
      newConversation: (surface?: 'chat' | 'code') => newConversation(surface),
    },
  }
})

import {
  assignSectionAfterLeavingKnowledge,
  enterKnowledge,
  enterPlaceholderSection,
  enterSection,
  handleMainToolbarBack,
  leaveKnowledge,
  openAutomationFromChrome,
  openHistoryFromChrome,
  openSettingsFromChrome,
} from './sidebarActions'

describe('sidebarActions', () => {
  beforeEach(() => {
    flushSave.mockClear()
    knowledgeState.loadSpaces.mockClear()
    openSpace.mockClear()
    setSurface.mockClear()
    selectSession.mockClear()
    newConversation.mockClear()
    knowledgeState.spaces = []
    knowledgeState.mode = 'home'
    knowledgeState.activeSpaceId = null
    knowledgeState.loadSpaces.mockImplementation(async () => {})
    useDomainStore.setState({
      sessions: [],
      activeSessionId: null,
    } as never)
    useUiStore.setState({
      activeView: 'chat',
      previousView: null,
      sidebarSection: 'chats',
    })
  })

  it('leaveKnowledge no-ops when not on knowledge', async () => {
    await leaveKnowledge()
    expect(flushSave).not.toHaveBeenCalled()
  })

  it('leaveKnowledge flushes without changing activeView', async () => {
    useUiStore.setState({ activeView: 'knowledge' })
    await leaveKnowledge()
    expect(flushSave).toHaveBeenCalled()
    // activeView left for caller
    expect(useUiStore.getState().activeView).toBe('knowledge')
  })

  it('enterKnowledge opens view, section, and loadSpaces', async () => {
    await enterKnowledge()
    expect(useUiStore.getState().activeView).toBe('knowledge')
    expect(useUiStore.getState().sidebarSection).toBe('knowledge')
    expect(knowledgeState.loadSpaces).toHaveBeenCalled()
  })

  it('enterKnowledge opens first space by name when none active', async () => {
    knowledgeState.loadSpaces.mockImplementation(async () => {
      knowledgeState.spaces = [
        { id: 'z', name: 'Zebra' },
        { id: 'a', name: 'Alpha' },
      ]
      knowledgeState.mode = 'home'
      knowledgeState.activeSpaceId = null
    })
    await enterKnowledge()
    expect(openSpace).toHaveBeenCalledWith('a')
  })

  it('enterKnowledge keeps current workspace when still valid', async () => {
    knowledgeState.spaces = [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
    ]
    knowledgeState.mode = 'workspace'
    knowledgeState.activeSpaceId = 'b'
    knowledgeState.loadSpaces.mockImplementation(async () => {
      // reload keeps same spaces
    })
    await enterKnowledge()
    expect(openSpace).not.toHaveBeenCalled()
  })

  it('enterKnowledge does not openSpace when there are no spaces', async () => {
    knowledgeState.loadSpaces.mockImplementation(async () => {
      knowledgeState.spaces = []
    })
    await enterKnowledge()
    expect(openSpace).not.toHaveBeenCalled()
  })

  it('enterSection leaves knowledge and setSurface', async () => {
    useUiStore.setState({ activeView: 'knowledge' })
    await enterSection('projects')
    expect(flushSave).toHaveBeenCalled()
    expect(setSurface).toHaveBeenCalledWith('code')
    expect(useUiStore.getState().sidebarSection).toBe('projects')
  })

  it('enterPlaceholderSection sets workbench view and section', async () => {
    useUiStore.setState({ activeView: 'chat', sidebarSection: 'chats' })
    await enterPlaceholderSection('workbench')
    expect(useUiStore.getState().activeView).toBe('workbench')
    expect(useUiStore.getState().sidebarSection).toBe('workbench')
    expect(setSurface).not.toHaveBeenCalled()
  })

  it('enterTerminalsSection flushes knowledge then opens terminals', async () => {
    const { enterTerminalsSection } = await import('./sidebarActions')
    useUiStore.setState({ activeView: 'knowledge', sidebarSection: 'knowledge' })
    await enterTerminalsSection()
    expect(flushSave).toHaveBeenCalled()
    expect(useUiStore.getState().activeView).toBe('terminals')
    expect(useUiStore.getState().sidebarSection).toBe('terminals')
  })

  it('enterTerminalsSection({ library: true }) clears focused managed terminal', async () => {
    const { enterTerminalsSection } = await import('./sidebarActions')
    const { useManagedTerminalStore } = await import('@/store/managedTerminalStore')
    useManagedTerminalStore.setState({
      terminals: [
        {
          id: 'tm_1',
          kind: 'local',
          title: 'home',
          cwd: '/tmp',
          createdAt: 1,
        },
      ],
      focusedId: 'tm_1',
    })
    useUiStore.setState({ activeView: 'chat', sidebarSection: 'chats' })
    await enterTerminalsSection({ library: true })
    expect(useManagedTerminalStore.getState().focusedId).toBeNull()
    expect(useUiStore.getState().activeView).toBe('terminals')
  })

  it('enterTerminalsSection without library keeps focused terminal', async () => {
    const { enterTerminalsSection } = await import('./sidebarActions')
    const { useManagedTerminalStore } = await import('@/store/managedTerminalStore')
    useManagedTerminalStore.setState({
      terminals: [
        {
          id: 'tm_keep',
          kind: 'local',
          title: 'home',
          cwd: '/tmp',
          createdAt: 1,
        },
      ],
      focusedId: 'tm_keep',
    })
    await enterTerminalsSection()
    expect(useManagedTerminalStore.getState().focusedId).toBe('tm_keep')
  })

  it('enterPlaceholderSection opens automation under primary nav', async () => {
    useUiStore.setState({ activeView: 'chat', sidebarSection: 'chats' })
    await enterPlaceholderSection('automation')
    expect(useUiStore.getState().activeView).toBe('automation')
    expect(useUiStore.getState().sidebarSection).toBe('automation')
  })

  it('openAutomationFromChrome opens automation special view', async () => {
    useUiStore.setState({ activeView: 'chat', sidebarSection: 'chats' })
    await openAutomationFromChrome()
    expect(useUiStore.getState().activeView).toBe('automation')
  })

  it('openSettingsFromChrome flushes knowledge and assigns section', async () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          title: 't',
          preview: '',
          updatedAtMs: 1,
          config: { ...DEFAULT_CONFIG, surface: 'code' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 's1',
    } as never)
    useUiStore.setState({
      activeView: 'knowledge',
      sidebarSection: 'knowledge',
      settingsPage: 'model',
    })
    await openSettingsFromChrome()
    expect(flushSave).toHaveBeenCalled()
    expect(useUiStore.getState().activeView).toBe('settings')
    expect(useUiStore.getState().settingsPage).toBe('general')
    expect(useUiStore.getState().previousView).toBe('knowledge')
    expect(useUiStore.getState().sidebarSection).toBe('projects')
  })

  it('openHistoryFromChrome uses same flush/section rule', async () => {
    useUiStore.setState({
      activeView: 'knowledge',
      sidebarSection: 'knowledge',
    })
    await openHistoryFromChrome()
    expect(flushSave).toHaveBeenCalled()
    expect(useUiStore.getState().activeView).toBe('history')
    expect(useUiStore.getState().sidebarSection).toBe('chats')
  })

  it('handleMainToolbarBack restores knowledge section', () => {
    useUiStore.setState({
      activeView: 'settings',
      previousView: 'knowledge',
      sidebarSection: 'chats',
    })
    handleMainToolbarBack()
    expect(useUiStore.getState().activeView).toBe('knowledge')
    expect(useUiStore.getState().sidebarSection).toBe('knowledge')
  })

  it('assignSectionAfterLeavingKnowledge uses active session surface', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 'c1',
          title: 't',
          preview: '',
          updatedAtMs: 1,
          config: { ...DEFAULT_CONFIG, surface: 'chat' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 'c1',
    } as never)
    useUiStore.setState({ sidebarSection: 'knowledge' })
    assignSectionAfterLeavingKnowledge()
    expect(useUiStore.getState().sidebarSection).toBe('chats')
  })
})
