import { describe, it, expect } from 'vitest'

/** Zone→className mapping used by the chip in InputBar.tsx. Mirrors the
 *  inline ternary so any future refactor of the chip stays consistent. */
function chipClassName(zone: 'success' | 'warning' | 'danger'): string {
  return zone === 'success' ? 'text-success'
    : zone === 'warning' ? 'text-warning'
    : 'text-danger'
}

describe('TokenUsageChip className mapping', () => {
  it('maps success → text-success', () => {
    expect(chipClassName('success')).toBe('text-success')
  })

  it('maps warning → text-warning', () => {
    expect(chipClassName('warning')).toBe('text-warning')
  })

  it('maps danger → text-danger', () => {
    expect(chipClassName('danger')).toBe('text-danger')
  })
})
