// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MascotActor } from './MascotActor'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('MascotActor', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  it('renders a motion svg img with data-mascot-action when motion is allowed', () => {
    const { container } = render(<MascotActor size={200} />)
    const wrap = container.querySelector('[data-mascot-action]')
    expect(wrap).toBeInTheDocument()
    expect(wrap).toHaveAttribute('data-mascot-action', 'wave')

    const img = container.querySelector('img')
    expect(img).toBeInTheDocument()
    expect(img?.getAttribute('src')).toMatch(/motion\/lifestyle\/logo-wave\.svg$/)
  })

  it('falls back to HipLogo when prefers-reduced-motion', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    const { container } = render(<MascotActor />)
    expect(container.querySelector('[data-mascot-action]')).not.toBeInTheDocument()
    expect(container.querySelector('img[src="/logo.svg"]')).toBeInTheDocument()
  })

  it('honors initialAction for the first clip', () => {
    const { container } = render(<MascotActor initialAction="code" />)
    expect(container.querySelector('[data-mascot-action]')).toHaveAttribute(
      'data-mascot-action',
      'code',
    )
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toMatch(/motion\/work\/logo-code\.svg$/)
  })

  it('dual-buffers motion imgs when crossfade is enabled', () => {
    const { container } = render(<MascotActor size={160} crossfade collapseBottomPad={false} />)
    const wrap = container.querySelector('[data-mascot-crossfade="true"]')
    expect(wrap).toBeInTheDocument()
    const imgs = container.querySelectorAll('img')
    expect(imgs.length).toBe(2)
    expect(imgs[0]?.getAttribute('src')).toMatch(/motion\/lifestyle\/logo-wave\.svg$/)
    expect(imgs[1]?.getAttribute('src')).toMatch(/motion\/lifestyle\/logo-wave\.svg$/)
  })
})

