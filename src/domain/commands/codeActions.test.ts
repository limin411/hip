// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runDiff, runCompact, runInit, buildInitPrompt } from './codeActions'
import { sessionService } from '../sessionService'
import { useDomainStore } from '../sessionStore'
import { useUiStore } from '@/store/uiStore'

const toastError = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    message: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

describe('codeActions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    toastError.mockClear()
    useUiStore.setState({ activeView: 'chat', activeTab: 'files' })
    useDomainStore.setState({ sessions: [], activeSessionId: null, connection: 'disconnected' })
    useDomainStore.getState().createSession('s1', {
      llmProvider: 'deepseek',
      model: 'm',
      tools: [],
      cwd: '/tmp/proj',
    })
  })

  it('runDiff requests diff, opens changes tab, switches to code, opens panel', () => {
    const spy = vi.spyOn(sessionService, 'requestDiff').mockReturnValue('sent')
    runDiff('s1')
    expect(spy).toHaveBeenCalledWith('s1')
    expect(useUiStore.getState().activeTab).toBe('changes')
    expect(useUiStore.getState().activeView).toBe('code')
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(true)
  })

  it('runDiff navigates even when request is deduped', () => {
    vi.spyOn(sessionService, 'requestDiff').mockReturnValue('deduped')
    runDiff('s1')
    expect(useUiStore.getState().activeTab).toBe('changes')
    expect(useUiStore.getState().activeView).toBe('code')
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(true)
  })

  it('runCompact calls compactSession', () => {
    const spy = vi.spyOn(sessionService, 'compactSession').mockReturnValue(undefined)
    runCompact('s1')
    expect(spy).toHaveBeenCalledWith('s1', undefined)
  })

  it('runCompact forwards optional focus', () => {
    const spy = vi.spyOn(sessionService, 'compactSession').mockReturnValue(undefined)
    runCompact('s1', 'auth')
    expect(spy).toHaveBeenCalledWith('s1', 'auth')
  })

  it('runInit sends AGENTS.md init prompt (not git init)', () => {
    useDomainStore.setState({ activeSessionId: 's1' })
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)
    const gitSpy = vi.spyOn(sessionService, 'gitInitWorkspace').mockReturnValue(undefined)
    runInit('s1')
    expect(gitSpy).not.toHaveBeenCalled()
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const prompt = sendSpy.mock.calls[0][0] as string
    expect(prompt).toContain('AGENTS.md')
    expect(prompt).toBe(buildInitPrompt())
  })

  it('runInit forwards optional focus into the prompt', () => {
    useDomainStore.setState({ activeSessionId: 's1' })
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)
    runInit('s1', 'focus on testing')
    expect(sendSpy).toHaveBeenCalledWith(buildInitPrompt('focus on testing'))
  })

  it('runInit selects the session when it is not active', () => {
    useDomainStore.setState({ activeSessionId: null })
    const selectSpy = vi.spyOn(sessionService, 'selectSession').mockReturnValue(undefined)
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)
    runInit('s1')
    expect(selectSpy).toHaveBeenCalledWith('s1')
    expect(sendSpy).toHaveBeenCalledTimes(1)
  })

  it('runInit toasts and does not send when session has no cwd', () => {
    useDomainStore.getState().createSession('s2', {
      llmProvider: 'deepseek',
      model: 'm',
      tools: [],
    })
    useDomainStore.setState({ activeSessionId: 's2' })
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)
    runInit('s2')
    expect(sendSpy).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalled()
  })

  it('runInit no-ops for unknown sessionId', () => {
    const sendSpy = vi.spyOn(sessionService, 'sendMessage').mockReturnValue(undefined)
    runInit('missing')
    expect(sendSpy).not.toHaveBeenCalled()
  })
})
