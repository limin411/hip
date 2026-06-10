import { describe, it, expect } from 'vitest'
import { resolveStyleLabel } from './styles'

const presets = [{ id: '1', name: 'Terse', text: 'Be brief' }]

describe('resolveStyleLabel', () => {
  it('returns none when no instructions are set', () => {
    expect(resolveStyleLabel(undefined, presets)).toEqual({ kind: 'none' })
  })
  it('returns the preset name when the text matches a preset', () => {
    expect(resolveStyleLabel('Be brief', presets)).toEqual({ kind: 'preset', name: 'Terse' })
  })
  it('returns custom when instructions are set but match no preset', () => {
    expect(resolveStyleLabel('Something else', presets)).toEqual({ kind: 'custom' })
  })
})
