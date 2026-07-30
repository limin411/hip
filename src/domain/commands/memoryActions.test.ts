// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  openMemorySettings,
  setUseMemories,
  setIncognito,
  showMemoryStatus,
  formatMemoryStatusBody,
  toastMemoryFlagChange,
} from './memoryActions'
import { sessionService } from '../sessionService'
import { useDomainStore } from '../sessionStore'
import { useUiStore } from '@/store/uiStore'
import '@/i18n'

const toastMessage = vi.fn()
vi.mock('sonner', () => ({
  toast: { message: (...args: unknown[]) => toastMessage(...args) },
}))

describe('memoryActions', () => {
  beforeEach(() => {
    toastMessage.mockClear()
    useUiStore.setState({ activeView: 'chat', settingsPage: 'general' })
    useDomainStore.setState({ sessions: [], activeSessionId: null })
  })

  it('openMemorySettings opens settings overlay on memory page', () => {
    openMemorySettings()
    expect(useUiStore.getState().settingsPage).toBe('memory')
    expect(useUiStore.getState().overlay).toBe('settings')
    expect(useUiStore.getState().activeView).toBe('chat')
  })

  it('setUseMemories forwards to sessionService', () => {
    const spy = vi.spyOn(sessionService, 'setMemoryFlags').mockReturnValue(undefined)
    setUseMemories('s1', true)
    expect(spy).toHaveBeenCalledWith('s1', { useMemories: true })
    spy.mockRestore()
  })

  it('setIncognito forwards to sessionService', () => {
    const spy = vi.spyOn(sessionService, 'setMemoryFlags').mockReturnValue(undefined)
    setIncognito('s1')
    expect(spy).toHaveBeenCalledWith('s1', { incognito: true })
    spy.mockRestore()
  })

  it('setIncognito(false) exits incognito', () => {
    const spy = vi.spyOn(sessionService, 'setMemoryFlags').mockReturnValue(undefined)
    setIncognito('s1', false)
    expect(spy).toHaveBeenCalledWith('s1', { incognito: false })
    spy.mockRestore()
  })

  it('toastMemoryFlagChange shows a message', () => {
    toastMemoryFlagChange('useOn')
    expect(toastMessage).toHaveBeenCalled()
  })

  it('formatMemoryStatusBody reads session flags', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: {
            llmProvider: 'openai',
            model: 'gpt-4o',
            tools: [],
            surface: 'chat',
            useMemories: true,
            generateMemories: false,
            incognito: false,
          },
          title: 't',
          preview: '',
          updatedAtMs: 1,
          loaded: true,
          messages: [],
          status: 'idle',
          error: null,
        },
      ],
      activeSessionId: 's1',
    })
    expect(formatMemoryStatusBody('s1')).toEqual({
      use: 'true',
      generate: 'false',
      incognito: 'false',
    })
  })

  it('showMemoryStatus toasts provided copy', () => {
    showMemoryStatus('s1', { title: 'Memory status', body: 'use=true' })
    expect(toastMessage).toHaveBeenCalledWith('Memory status', { description: 'use=true' })
  })
})
