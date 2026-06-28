// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { HipLogo } from './HipLogo'

afterEach(() => {
  cleanup()
})

describe('HipLogo', () => {
  it('renders img with src="/logo.svg" and wrapper with role="img" aria-label="hip"', () => {
    const { container } = render(<HipLogo />)

    const wrapper = container.querySelector('[role="img"]')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper).toHaveAttribute('aria-label', 'hip')

    const logo = container.querySelector('img[src="/logo.svg"]')
    expect(logo).toBeInTheDocument()
    expect(logo).toHaveAttribute('alt', '')
    expect(logo).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders aria-hidden="true" and empty alt when decorative', () => {
    const { container } = render(<HipLogo decorative />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveAttribute('aria-hidden', 'true')

    const logo = container.querySelector('img')
    expect(logo).toHaveAttribute('alt', '')
  })

  it('respects custom size and title', () => {
    const { container } = render(<HipLogo size={160} title="custom" />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveStyle({ width: '160px' })
    expect(wrapper).toHaveAttribute('aria-label', 'custom')
  })
})
