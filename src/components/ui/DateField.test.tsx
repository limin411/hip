// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DateField } from './DateField'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

afterEach(() => {
  cleanup()
})

describe('DateField', () => {
  it('renders formatted value and exposes hidden input for e2e', () => {
    const onChange = vi.fn()
    render(
      <DateField
        data-testid="work-item-start-input"
        value="2026-07-25"
        onChange={onChange}
      />,
    )
    const hidden = screen.getByTestId('work-item-start-input') as HTMLInputElement
    expect(hidden.value).toBe('2026-07-25')
    expect(screen.getByTestId('work-item-start-input-trigger')).toBeInTheDocument()
  })

  it('picks a day from the popover (pointerdown — click is canceled by Dialog outside guards)', () => {
    const onChange = vi.fn()
    render(
      <DateField
        data-testid="d"
        value="2026-07-25"
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByTestId('d-trigger'))
    // Real app: Dialog preventDefault on outside pointerdown kills click.
    fireEvent.pointerDown(screen.getByTestId('date-field-day-2026-07-10'), { button: 0 })
    expect(onChange).toHaveBeenCalledWith('2026-07-10')
  })

  it('accepts programmatic change on the hidden input', () => {
    const onChange = vi.fn()
    render(
      <DateField data-testid="d" value="2026-07-25" onChange={onChange} />,
    )
    const hidden = screen.getByTestId('d') as HTMLInputElement
    fireEvent.change(hidden, { target: { value: '2026-08-01' } })
    expect(onChange).toHaveBeenCalledWith('2026-08-01')
  })

  it('today button selects today', () => {
    const onChange = vi.fn()
    // Fixed: value in July so popover opens on that month; Today still picks real local today.
    render(
      <DateField data-testid="d" value="2026-07-25" onChange={onChange} />,
    )
    fireEvent.click(screen.getByTestId('d-trigger'))
    fireEvent.pointerDown(screen.getByTestId('date-field-today'), { button: 0 })
    expect(onChange).toHaveBeenCalledTimes(1)
    const ymd = onChange.mock.calls[0]![0] as string
    expect(ymd).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('today works even when value is far in the past (no max clamp)', () => {
    const onChange = vi.fn()
    render(
      <DateField data-testid="d" value="2020-01-15" onChange={onChange} />,
    )
    fireEvent.click(screen.getByTestId('d-trigger'))
    // Today must not be disabled just because the stored date is old.
    expect(screen.getByTestId('date-field-today')).not.toBeDisabled()
    fireEvent.pointerDown(screen.getByTestId('date-field-today'), { button: 0 })
    expect(onChange).toHaveBeenCalled()
  })
})
