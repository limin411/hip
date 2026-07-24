// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionService, useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import { useUiStore } from '@/store/uiStore'
import { useNavHistoryStore, type NavEntry } from '@/store/navHistoryStore'
import {
  applyNavEntry,
  captureNavEntry,
  goNavBack,
  goNavForward,
  recordNavEntry,
  seedColdLaunchNavHistory,
} from './navHistory'

describe('navHistory helpers', () => {
  beforeEach(() => {
    useNavHistoryStore.setState({ stack: [], index: -1, applying: false })
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          title: 'One',
          preview: '',
          updatedAtMs: 1,
          config: { ...DEFAULT_CONFIG, surface: 'chat' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
        {
          id: 's2',
          title: 'Two',
          preview: '',
          updatedAtMs: 2,
          config: { ...DEFAULT_CONFIG, surface: 'chat' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: null,
    } as never)
    useUiStore.setState({
      activeView: 'workbench',
      sidebarSection: 'workbench',
      settingsPage: 'general',
    })
  })

  it('seed + record + back/forward restores sessions', async () => {
    const selectSpy = vi.spyOn(sessionService, 'selectSession').mockImplementation(() => {})

    seedColdLaunchNavHistory()
    expect(useNavHistoryStore.getState().canGoBack()).toBe(false)

    useUiStore.setState({ activeView: 'chat', sidebarSection: 'chats' })
    useDomainStore.setState({ activeSessionId: 's1' } as never)
    recordNavEntry()

    useDomainStore.setState({ activeSessionId: 's2' } as never)
    recordNavEntry()

    expect(useNavHistoryStore.getState().canGoBack()).toBe(true)
    expect(useNavHistoryStore.getState().stack).toHaveLength(3)

    const ok = await goNavBack()
    expect(ok).toBe(true)
    expect(selectSpy).toHaveBeenCalledWith('s1')
    expect(useNavHistoryStore.getState().canGoForward()).toBe(true)

    selectSpy.mockClear()
    await goNavForward()
    expect(selectSpy).toHaveBeenCalledWith('s2')

    selectSpy.mockRestore()
  })

  it('applyNavEntry sets settings without selecting a session', async () => {
    const selectSpy = vi.spyOn(sessionService, 'selectSession').mockImplementation(() => {})
    const entry: NavEntry = {
      ...captureNavEntry(),
      activeView: 'settings',
      sidebarSection: 'chats',
      settingsPage: 'model',
      sessionId: null,
    }
    await applyNavEntry(entry)
    expect(useUiStore.getState().activeView).toBe('settings')
    expect(useUiStore.getState().settingsPage).toBe('model')
    expect(selectSpy).not.toHaveBeenCalled()
    expect(useNavHistoryStore.getState().applying).toBe(false)
    selectSpy.mockRestore()
  })

  it('record is no-op while applying', () => {
    seedColdLaunchNavHistory()
    useNavHistoryStore.getState().setApplying(true)
    useDomainStore.setState({ activeSessionId: 's1' } as never)
    useUiStore.setState({ activeView: 'chat', sidebarSection: 'chats' })
    recordNavEntry()
    expect(useNavHistoryStore.getState().stack).toHaveLength(1)
    useNavHistoryStore.getState().setApplying(false)
  })

  it('goNavBack returns false at start of stack', async () => {
    seedColdLaunchNavHistory()
    expect(await goNavBack()).toBe(false)
  })
})
