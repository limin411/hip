// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'

const flushSave = vi.fn(async () => true)
const workItemFlushSave = vi.fn(async () => {})
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

const workItemState = {
  loaded: true,
  load: vi.fn(async () => {}),
  flushSave: () => workItemFlushSave(),
}

const automationState = {
  loaded: true,
  load: vi.fn(async () => {}),
}

vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: {
    getState: () => knowledgeState,
  },
}))

vi.mock('@/store/workItemStore', () => ({
  useWorkItemStore: {
    getState: () => workItemState,
  },
}))

vi.mock('@/store/automationStore', () => ({
  useAutomationStore: {
    getState: () => automationState,
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
      requestTrashList: vi.fn(),
    },
  }
})

import {
  assignSectionAfterLeavingKnowledge,
  enterKnowledge,
  enterSection,
  enterWorkItemsSection,
  enterAutomationsSection,
  handleMainToolbarBack,
  leaveKnowledge,
  leaveWorkItems,
  openAutomationFromChrome,
  openHistoryFromChrome,
  openHistoryOverlay,
  openSettingsFromChrome,
  openSettingsOverlay,
  openTrashFromChrome,
  openTrashOverlay,
  selectSessionFromSidebar,
  toggleHistoryOverlay,
  toggleTrashOverlay,
} from './sidebarActions'

describe('sidebarActions', () => {
  beforeEach(() => {
    flushSave.mockClear()
    workItemFlushSave.mockClear()
    workItemState.load.mockClear()
    knowledgeState.loadSpaces.mockClear()
    openSpace.mockClear()
    setSurface.mockClear()
    selectSession.mockClear()
    newConversation.mockClear()
    knowledgeState.spaces = []
    knowledgeState.mode = 'home'
    knowledgeState.activeSpaceId = null
    knowledgeState.loadSpaces.mockImplementation(async () => {})
    workItemState.loaded = true
    useDomainStore.setState({
      sessions: [],
      activeSessionId: null,
    } as never)
    useUiStore.setState({
      activeView: 'chat',
      previousView: null,
      sidebarSection: 'chats',
      overlay: null,
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

  it('enterAutomationsSection opens automation and loads catalog when not loaded', async () => {
    automationState.loaded = false
    automationState.load.mockClear()
    useUiStore.setState({ activeView: 'chat', sidebarSection: 'chats' })
    await enterAutomationsSection()
    expect(useUiStore.getState().activeView).toBe('automation')
    expect(useUiStore.getState().sidebarSection).toBe('automation')
    expect(automationState.load).toHaveBeenCalled()
    automationState.loaded = true
  })

  it('openAutomationFromChrome opens automation via enterAutomationsSection when flag on', async () => {
    useUiStore.setState({ activeView: 'chat', sidebarSection: 'chats' })
    await openAutomationFromChrome()
    expect(useUiStore.getState().activeView).toBe('automation')
    expect(useUiStore.getState().sidebarSection).toBe('automation')
  })

  it('openSettingsFromChrome opens overlay on General without leave-flush', () => {
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
      overlay: null,
    })
    openSettingsFromChrome()
    expect(flushSave).not.toHaveBeenCalled()
    expect(useUiStore.getState().activeView).toBe('knowledge')
    expect(useUiStore.getState().settingsPage).toBe('general')
    expect(useUiStore.getState().overlay).toBe('settings')
    // Settings preserves content section (work surface stays mounted).
    expect(useUiStore.getState().sidebarSection).toBe('knowledge')
  })

  it('openSettingsOverlay(page) sets page and opens settings overlay', () => {
    useUiStore.setState({
      activeView: 'chat',
      settingsPage: 'general',
      overlay: null,
    })
    openSettingsOverlay('memory')
    expect(useUiStore.getState().settingsPage).toBe('memory')
    expect(useUiStore.getState().overlay).toBe('settings')
    expect(useUiStore.getState().activeView).toBe('chat')
  })

  it('openSettingsOverlay() without page resets to general', () => {
    useUiStore.setState({ settingsPage: 'model', overlay: null })
    openSettingsOverlay()
    expect(useUiStore.getState().settingsPage).toBe('general')
    expect(useUiStore.getState().overlay).toBe('settings')
  })

  it('openHistoryOverlay does not leave knowledge / change activeView', () => {
    useUiStore.setState({
      activeView: 'knowledge',
      sidebarSection: 'knowledge',
      overlay: null,
    })
    openHistoryOverlay()
    expect(flushSave).not.toHaveBeenCalled()
    expect(useUiStore.getState().activeView).toBe('knowledge')
    expect(useUiStore.getState().sidebarSection).toBe('knowledge')
    expect(useUiStore.getState().overlay).toBe('history')
  })

  it('openHistoryFromChrome opens overlay without leave-flush', () => {
    useUiStore.setState({
      activeView: 'knowledge',
      sidebarSection: 'knowledge',
      overlay: null,
    })
    openHistoryFromChrome()
    expect(flushSave).not.toHaveBeenCalled()
    expect(useUiStore.getState().overlay).toBe('history')
    expect(useUiStore.getState().activeView).toBe('knowledge')
  })

  it('toggleHistoryOverlay closes when already open', () => {
    useUiStore.setState({ overlay: 'history', activeView: 'chat' })
    toggleHistoryOverlay()
    expect(useUiStore.getState().overlay).toBeNull()
  })

  it('handleMainToolbarBack restores knowledge section', async () => {
    useUiStore.setState({
      activeView: 'settings',
      previousView: 'knowledge',
      sidebarSection: 'chats',
    })
    await handleMainToolbarBack()
    expect(useUiStore.getState().activeView).toBe('knowledge')
    expect(useUiStore.getState().sidebarSection).toBe('knowledge')
  })

  it('leaveWorkItems no-ops when not on tasks', async () => {
    await leaveWorkItems()
    expect(workItemFlushSave).not.toHaveBeenCalled()
  })

  it('leaveWorkItems flushes when on tasks', async () => {
    useUiStore.setState({ activeView: 'tasks', sidebarSection: 'tasks' })
    await leaveWorkItems()
    expect(workItemFlushSave).toHaveBeenCalled()
    expect(useUiStore.getState().activeView).toBe('tasks')
  })

  it('handleMainToolbarBack leaves tasks via leaveWorkItems before changing view', async () => {
    useUiStore.setState({
      activeView: 'tasks',
      previousView: 'chat',
      sidebarSection: 'tasks',
    })
    await handleMainToolbarBack()
    expect(workItemFlushSave).toHaveBeenCalled()
    expect(useUiStore.getState().activeView).toBe('chat')
    expect(useUiStore.getState().sidebarSection).toBe('chats')
  })

  it('enterSection flushes work items when leaving tasks', async () => {
    useUiStore.setState({ activeView: 'tasks', sidebarSection: 'tasks' })
    await enterSection('chats')
    expect(workItemFlushSave).toHaveBeenCalled()
    expect(setSurface).toHaveBeenCalledWith('chat')
    expect(useUiStore.getState().sidebarSection).toBe('chats')
  })

  it('enterWorkItemsSection opens tasks and loads catalog when not loaded', async () => {
    workItemState.loaded = false
    useUiStore.setState({ activeView: 'chat', sidebarSection: 'chats' })
    const { useWorkItemViewStore } = await import('@/store/workItemViewStore')
    useWorkItemViewStore.getState().setViewMode('list')
    await enterWorkItemsSection()
    expect(useUiStore.getState().activeView).toBe('tasks')
    expect(useUiStore.getState().sidebarSection).toBe('tasks')
    expect(workItemState.load).toHaveBeenCalled()
    expect(useWorkItemViewStore.getState().viewMode).toBe('calendar')
  })

  it('enterWorkItemsSection resets viewMode to calendar when already on tasks', async () => {
    useUiStore.setState({ activeView: 'tasks', sidebarSection: 'tasks' })
    const { useWorkItemViewStore } = await import('@/store/workItemViewStore')
    useWorkItemViewStore.getState().setViewMode('list')
    await enterWorkItemsSection()
    expect(useWorkItemViewStore.getState().viewMode).toBe('calendar')
  })

  it('openSettingsFromChrome does not flush work items; keeps tasks section', () => {
    useUiStore.setState({ activeView: 'tasks', sidebarSection: 'tasks', overlay: null })
    openSettingsFromChrome()
    expect(workItemFlushSave).not.toHaveBeenCalled()
    expect(useUiStore.getState().activeView).toBe('tasks')
    expect(useUiStore.getState().overlay).toBe('settings')
    // Keep tasks rail highlight; do not snap to chats/projects.
    expect(useUiStore.getState().sidebarSection).toBe('tasks')
  })

  it('openSettingsFromChrome replaces trash/history overlay with settings', () => {
    useUiStore.setState({
      activeView: 'chat',
      sidebarSection: 'chats',
      overlay: 'trash',
    })
    openSettingsFromChrome()
    expect(useUiStore.getState().overlay).toBe('settings')
    expect(useUiStore.getState().activeView).toBe('chat')
    expect(useUiStore.getState().settingsPage).toBe('general')
  })

  it('openSettingsFromChrome toggles closed when settings already open', () => {
    useUiStore.setState({ overlay: 'settings', activeView: 'chat' })
    openSettingsFromChrome()
    expect(useUiStore.getState().overlay).toBeNull()
  })

  it('enterWorkItemsSection restores tasks view from trash', async () => {
    useUiStore.setState({
      activeView: 'trash',
      previousView: 'tasks',
      sidebarSection: 'chats',
    })
    await enterWorkItemsSection()
    expect(useUiStore.getState().activeView).toBe('tasks')
    expect(useUiStore.getState().sidebarSection).toBe('tasks')
  })

  it('enterWorkItemsSection restores tasks when section was left stale as tasks under trash', async () => {
    // Pre-fix pairing: trash main + tasks list (would make filter clicks no-op).
    useUiStore.setState({
      activeView: 'trash',
      previousView: 'tasks',
      sidebarSection: 'tasks',
    })
    await enterWorkItemsSection()
    expect(useUiStore.getState().activeView).toBe('tasks')
    expect(useUiStore.getState().sidebarSection).toBe('tasks')
  })

  it('openTrashOverlay does not leave tasks / change activeView', () => {
    useUiStore.setState({ activeView: 'tasks', sidebarSection: 'tasks', overlay: null })
    openTrashOverlay()
    expect(workItemFlushSave).not.toHaveBeenCalled()
    expect(useUiStore.getState().activeView).toBe('tasks')
    expect(useUiStore.getState().sidebarSection).toBe('tasks')
    expect(useUiStore.getState().overlay).toBe('trash')
  })

  it('openTrashFromChrome opens overlay without leave-flush', () => {
    useUiStore.setState({ activeView: 'tasks', sidebarSection: 'tasks', overlay: null })
    openTrashFromChrome()
    expect(workItemFlushSave).not.toHaveBeenCalled()
    expect(useUiStore.getState().overlay).toBe('trash')
    expect(useUiStore.getState().activeView).toBe('tasks')
  })

  it('toggleTrashOverlay closes when already open', () => {
    useUiStore.setState({ overlay: 'trash', activeView: 'chat' })
    toggleTrashOverlay()
    expect(useUiStore.getState().overlay).toBeNull()
  })

  it('selectSessionFromSidebar dismisses history overlay but not settings', async () => {
    useUiStore.setState({ overlay: 'history', activeView: 'chat' })
    await selectSessionFromSidebar('s1')
    expect(selectSession).toHaveBeenCalledWith('s1')
    expect(useUiStore.getState().overlay).toBeNull()

    useUiStore.setState({ overlay: 'settings', activeView: 'chat' })
    await selectSessionFromSidebar('s1')
    expect(useUiStore.getState().overlay).toBe('settings')
  })

  it('selectSessionFromSidebar dismisses trash overlay', async () => {
    useUiStore.setState({ overlay: 'trash', activeView: 'chat' })
    await selectSessionFromSidebar('s1')
    expect(useUiStore.getState().overlay).toBeNull()
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

  it('enterWorkItemsSection skips load when already loaded', async () => {
    workItemState.loaded = true
    workItemState.load.mockClear()
    await enterWorkItemsSection()
    expect(workItemState.load).not.toHaveBeenCalled()
  })

  it('enterKnowledge flushes work items when leaving tasks', async () => {
    useUiStore.setState({ activeView: 'tasks', sidebarSection: 'tasks' })
    await enterKnowledge()
    expect(workItemFlushSave).toHaveBeenCalled()
    expect(useUiStore.getState().activeView).toBe('knowledge')
  })

  it('enterTerminalsSection flushes work items when leaving tasks', async () => {
    const { enterTerminalsSection } = await import('./sidebarActions')
    useUiStore.setState({ activeView: 'tasks', sidebarSection: 'tasks' })
    await enterTerminalsSection()
    expect(workItemFlushSave).toHaveBeenCalled()
    expect(useUiStore.getState().activeView).toBe('terminals')
  })


})
