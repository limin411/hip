// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { Mail } from 'lucide-react'
import { AuthButton } from './AuthButton'

afterEach(() => {
  cleanup()
})

describe('AuthButton', () => {
  it('renders label and fires onClick', () => {
    const onClick = vi.fn()
    const { getByRole } = render(
      <AuthButton icon={Mail} label="Continue with Email" onClick={onClick} variant="solid" />,
    )
    const btn = getByRole('button', { name: /Continue with Email/i })
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('uses elevated primary styles for solid (not brand sage fill)', () => {
    const { getByRole } = render(
      <AuthButton icon={Mail} label="Email" onClick={() => {}} variant="solid" />,
    )
    const btn = getByRole('button', { name: 'Email' })
    expect(btn.className).toMatch(/border-ink/)
    expect(btn.className).toMatch(/bg-surface/)
    expect(btn.className).not.toMatch(/bg-accent/)
  })

  it('uses soft gray fill for outline', () => {
    const { getByRole } = render(
      <AuthButton icon={Mail} label="GitHub" onClick={() => {}} />,
    )
    const btn = getByRole('button', { name: 'GitHub' })
    expect(btn.className).toMatch(/bg-\[#fafafa\]|bg-surface-subtle/)
  })
})
