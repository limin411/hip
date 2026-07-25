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
  it('renders native date input with value and styled trigger', () => {
    const onChange = vi.fn()
    render(
      <DateField
        data-testid="work-item-start-input"
        value="2026-07-25"
        onChange={onChange}
      />,
    )
    const input = screen.getByTestId('work-item-start-input') as HTMLInputElement
    expect(input).toHaveAttribute('type', 'date')
    expect(input.value).toBe('2026-07-25')
    expect(screen.getByTestId('work-item-start-input-trigger')).toBeInTheDocument()
  })

  it('forwards change from the native input', () => {
    const onChange = vi.fn()
    render(
      <DateField data-testid="d" value="2026-07-25" onChange={onChange} />,
    )
    const input = screen.getByTestId('d') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2026-08-01' } })
    expect(onChange).toHaveBeenCalledWith('2026-08-01')
  })

  it('falls back to today when cleared', () => {
    const onChange = vi.fn()
    render(
      <DateField data-testid="d" value="2026-07-25" onChange={onChange} />,
    )
    fireEvent.change(screen.getByTestId('d'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const ymd = onChange.mock.calls[0]![0] as string
    expect(ymd).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
