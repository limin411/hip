// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { SegmentedControl } from './SegmentedControl'

afterEach(() => {
  cleanup()
})

describe('SegmentedControl', () => {
  it('marks the active option and calls onChange', () => {
    const onChange = vi.fn()
    const { getByRole } = render(
      <SegmentedControl
        aria-label="View mode"
        options={[
          { value: 'unified', label: 'Unified' },
          { value: 'split', label: 'Split' },
        ]}
        value="unified"
        onChange={onChange}
      />,
    )

    const unified = getByRole('tab', { name: 'Unified' })
    const split = getByRole('tab', { name: 'Split' })
    expect(unified).toHaveAttribute('aria-selected', 'true')
    expect(split).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(split)
    expect(onChange).toHaveBeenCalledWith('split')
  })
})
