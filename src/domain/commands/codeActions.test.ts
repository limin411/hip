// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runDiff, runCompact, runInit } from './codeActions'
import { sessionService } from '../sessionService'
import { useUiStore } from '@/store/uiStore'

describe('codeActions', () => {
  beforeEach(() => {
    useUiStore.setState({ activeView: 'chat', activeTab: 'files' })
    vi.restoreAllMocks()
  })

  it('runDiff requests diff, opens changes tab, switches to code', () => {
    const spy = vi.spyOn(sessionService, 'requestDiff').mockReturnValue(undefined)
    runDiff('s1')
    expect(spy).toHaveBeenCalledWith('s1')
    expect(useUiStore.getState().activeTab).toBe('changes')
    expect(useUiStore.getState().activeView).toBe('code')
  })

  it('runCompact calls compactSession', () => {
    const spy = vi.spyOn(sessionService, 'compactSession').mockReturnValue(undefined)
    runCompact('s1')
    expect(spy).toHaveBeenCalledWith('s1')
  })

  it('runInit calls gitInitWorkspace', () => {
    const spy = vi.spyOn(sessionService, 'gitInitWorkspace').mockReturnValue(undefined)
    runInit('s1')
    expect(spy).toHaveBeenCalledWith('s1')
  })
})
