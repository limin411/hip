// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SurfaceToggle } from './SurfaceToggle'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('SurfaceToggle', () => {
  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('marks the active surface as pressed', () => {
    render(<SurfaceToggle active="chat" onChange={vi.fn()} />)
    expect(screen.getByTestId('surface-toggle-chat')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('surface-toggle-code')).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onChange with the selected surface when clicked', () => {
    const onChange = vi.fn()
    render(<SurfaceToggle active="chat" onChange={onChange} />)
    fireEvent.click(screen.getByTestId('surface-toggle-code'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('code')
  })
})
