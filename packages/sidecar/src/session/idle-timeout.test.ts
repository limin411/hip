import { describe, it, expect } from 'vitest'
import {
  resolveIdleTimeoutMs,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_CODE_IDLE_TIMEOUT_MS,
  MIN_IDLE_TIMEOUT_MS,
  MAX_IDLE_TIMEOUT_MS,
} from './idle-timeout.js'

describe('resolveIdleTimeoutMs', () => {
  it('defaults to 60s for chat / unset surface', () => {
    expect(resolveIdleTimeoutMs()).toBe(DEFAULT_IDLE_TIMEOUT_MS)
    expect(resolveIdleTimeoutMs({ surface: 'chat' })).toBe(DEFAULT_IDLE_TIMEOUT_MS)
  })

  it('defaults to 180s for code surface', () => {
    expect(resolveIdleTimeoutMs({ surface: 'code' })).toBe(DEFAULT_CODE_IDLE_TIMEOUT_MS)
  })

  it('prefers config over surface default', () => {
    expect(resolveIdleTimeoutMs({ surface: 'code', configMs: 90_000 })).toBe(90_000)
    expect(resolveIdleTimeoutMs({ surface: 'chat', configMs: 120_000 })).toBe(120_000)
  })

  it('prefers env over config and surface', () => {
    expect(
      resolveIdleTimeoutMs({
        env: '45000',
        configMs: 90_000,
        surface: 'code',
      }),
    ).toBe(45_000)
  })

  it('clamps below minimum', () => {
    expect(resolveIdleTimeoutMs({ env: '100' })).toBe(MIN_IDLE_TIMEOUT_MS)
    expect(resolveIdleTimeoutMs({ configMs: 1 })).toBe(MIN_IDLE_TIMEOUT_MS)
  })

  it('clamps above maximum', () => {
    expect(resolveIdleTimeoutMs({ env: String(MAX_IDLE_TIMEOUT_MS + 1) })).toBe(MAX_IDLE_TIMEOUT_MS)
    expect(resolveIdleTimeoutMs({ configMs: 9_999_999 })).toBe(MAX_IDLE_TIMEOUT_MS)
  })

  it('ignores invalid env and falls through', () => {
    expect(resolveIdleTimeoutMs({ env: 'nope', surface: 'code' })).toBe(DEFAULT_CODE_IDLE_TIMEOUT_MS)
    expect(resolveIdleTimeoutMs({ env: '', configMs: 70_000 })).toBe(70_000)
  })
})
