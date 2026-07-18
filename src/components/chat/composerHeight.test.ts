import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  COMPOSER_HEIGHT_DEFAULT,
  COMPOSER_HEIGHT_MIN,
  clampComposerHeight,
  heightFromDrag,
  loadComposerHeight,
  saveComposerHeight,
  COMPOSER_HEIGHT_KEY,
} from './composerHeight'

describe('composerHeight', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v)
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clamps to min/max', () => {
    expect(clampComposerHeight(10, 1000)).toBe(COMPOSER_HEIGHT_MIN)
    expect(clampComposerHeight(900, 1000)).toBe(450)
    expect(clampComposerHeight(120, 1000)).toBe(120)
  })

  it('drag up increases height', () => {
    expect(heightFromDrag(80, 400, 360, 1000)).toBe(120)
  })

  it('drag down decreases height', () => {
    expect(heightFromDrag(80, 400, 430, 1000)).toBe(50)
  })

  it('persists and reloads', () => {
    saveComposerHeight(128)
    expect(store.get(COMPOSER_HEIGHT_KEY)).toBe('128')
    expect(loadComposerHeight()).toBe(128)
  })

  it('falls back to default when storage empty', () => {
    expect(loadComposerHeight()).toBe(COMPOSER_HEIGHT_DEFAULT)
  })
})
