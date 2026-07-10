import { describe, it, expect, vi } from 'vitest'
import { shouldRefreshDiffOnToolFinish, createDebouncedFn, DIFF_REFRESH_TOOLS } from './diffRefreshOnWrite'

describe('diffRefreshOnWrite', () => {
  it('only triggers on successful write-like tools', () => {
    expect(shouldRefreshDiffOnToolFinish('write_file', 'finished')).toBe(true)
    expect(shouldRefreshDiffOnToolFinish('edit_file', 'finished')).toBe(true)
    expect(shouldRefreshDiffOnToolFinish('write_file', 'error')).toBe(false)
    expect(shouldRefreshDiffOnToolFinish('ls', 'finished')).toBe(false)
    expect(DIFF_REFRESH_TOOLS.has('git_commit')).toBe(true)
  })

  it('debounces per session id', async () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = createDebouncedFn(fn, 300)
    debounced('s1')
    debounced('s1')
    debounced('s2')
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenCalledWith('s1')
    expect(fn).toHaveBeenCalledWith('s2')
    vi.useRealTimers()
  })
})
