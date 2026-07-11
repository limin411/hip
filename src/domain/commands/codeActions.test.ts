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
    const spy = vi.spyOn(sessionService, 'requestDiff').mockReturnValue('sent')
    runDiff('s1')
    expect(spy).toHaveBeenCalledWith('s1')
    expect(useUiStore.getState().activeTab).toBe('changes')
    expect(useUiStore.getState().activeView).toBe('code')
  })

  it('runDiff navigates even when request is deduped', () => {
    vi.spyOn(sessionService, 'requestDiff').mockReturnValue('deduped')
    runDiff('s1')
    expect(useUiStore.getState().activeTab).toBe('changes')
    expect(useUiStore.getState().activeView).toBe('code')
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

  it('runInit calls gitInitWorkspace and opens Changes', () => {
    const spy = vi.spyOn(sessionService, 'gitInitWorkspace').mockReturnValue(undefined)
    runInit('s1')
    expect(spy).toHaveBeenCalledWith('s1')
    expect(useUiStore.getState().activeTab).toBe('changes')
    expect(useUiStore.getState().activeView).toBe('code')
  })
})
