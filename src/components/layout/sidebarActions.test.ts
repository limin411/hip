// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'

const flushSave = vi.fn(async () => true)
const loadSpaces = vi.fn(async () => {})
const openSpace = vi.fn(async (_id: string) => {})
const openHome = vi.fn(async () => {})
const setSurface = vi.fn((_view: 'chat' | 'code') => {})
const selectSession = vi.fn((_id: string) => {})
const newConversation = vi.fn((_surface?: 'chat' | 'code') => {})

vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: {
    getState: () => ({
      flushSave: () => flushSave(),
      loadSpaces: () => loadSpaces(),
      openSpace: (id: string) => openSpace(id),
      openHome: () => openHome(),
    }),
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
  enterSection,
  handleMainToolbarBack,
  leaveKnowledge,
  openHistoryFromChrome,
  openKnowledgeHome,
  openSettingsFromChrome,
} from './sidebarActions'

describe('sidebarActions', () => {
  beforeEach(() => {
    flushSave.mockClear()
    loadSpaces.mockClear()
    openSpace.mockClear()
    openHome.mockClear()
    setSurface.mockClear()
    selectSession.mockClear()
    newConversation.mockClear()
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
    expect(loadSpaces).toHaveBeenCalled()
  })

  it('openKnowledgeHome enters knowledge then openHome', async () => {
    await openKnowledgeHome()
    expect(useUiStore.getState().activeView).toBe('knowledge')
    expect(useUiStore.getState().sidebarSection).toBe('knowledge')
    expect(loadSpaces).toHaveBeenCalled()
    expect(openHome).toHaveBeenCalled()
  })

  it('enterSection leaves knowledge and setSurface', async () => {
    useUiStore.setState({ activeView: 'knowledge' })
    await enterSection('projects')
    expect(flushSave).toHaveBeenCalled()
    expect(setSurface).toHaveBeenCalledWith('code')
    expect(useUiStore.getState().sidebarSection).toBe('projects')
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
    })
    await openSettingsFromChrome()
    expect(flushSave).toHaveBeenCalled()
    expect(useUiStore.getState().activeView).toBe('settings')
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
