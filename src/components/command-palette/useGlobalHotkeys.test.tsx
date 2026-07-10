// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGlobalHotkeys } from './useGlobalHotkeys'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'

describe('useGlobalHotkeys', () => {
  beforeEach(() => {
    useCommandPaletteStore.setState({ open: false, page: null })
  })

  it('toggles palette open/closed on meta+k', () => {
    const { unmount } = renderHook(() => useGlobalHotkeys())

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    expect(useCommandPaletteStore.getState().open).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    expect(useCommandPaletteStore.getState().open).toBe(false)
    unmount()
  })

  it('toggles on ctrl+k', () => {
    const { unmount } = renderHook(() => useGlobalHotkeys())
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    expect(useCommandPaletteStore.getState().open).toBe(true)
    unmount()
  })

  it('ignores plain k without modifier', () => {
    const { unmount } = renderHook(() => useGlobalHotkeys())
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))
    expect(useCommandPaletteStore.getState().open).toBe(false)
    unmount()
  })
})
