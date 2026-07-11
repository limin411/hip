import { describe, it, expect } from 'vitest'
import { resolvePaletteSessionId } from './sessionResolve'

describe('resolvePaletteSessionId', () => {
  it('uses chat surface id on chat view', () => {
    expect(resolvePaletteSessionId('chat', 'c1', 'd1')).toBe('c1')
    expect(resolvePaletteSessionId('chat', null, 'd1')).toBeNull()
  })

  it('uses code surface id on code view', () => {
    expect(resolvePaletteSessionId('code', 'c1', 'd1')).toBe('d1')
    expect(resolvePaletteSessionId('code', 'c1', null)).toBeNull()
  })

  it('falls back chat then code on history/settings', () => {
    expect(resolvePaletteSessionId('history', 'c1', 'd1')).toBe('c1')
    expect(resolvePaletteSessionId('history', null, 'd1')).toBe('d1')
    expect(resolvePaletteSessionId('settings', null, null)).toBeNull()
    expect(resolvePaletteSessionId('settings', null, 'd1')).toBe('d1')
  })
})
