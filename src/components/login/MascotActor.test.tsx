// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ACTION_PATH, MascotActor, type MascotAction } from './MascotActor'

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

  it('ACTION_PATH covers 116 stickers and every file exists under public/motion', () => {
    const keys = Object.keys(ACTION_PATH) as MascotAction[]
    expect(keys).toHaveLength(116)
    const paths = Object.values(ACTION_PATH)
    expect(new Set(paths).size).toBe(116)
    const motionRoot = resolve(process.cwd(), 'public/motion')
    for (const rel of paths) {
      expect(existsSync(resolve(motionRoot, rel)), `missing public/motion/${rel}`).toBe(true)
    }
  })

  it('renders a motion svg img with data-mascot-action when motion is allowed', () => {
    const { container } = render(<MascotActor size={200} />)
    const wrap = container.querySelector('[data-mascot-action]')
    expect(wrap).toBeInTheDocument()
    expect(wrap).toHaveAttribute('data-mascot-action', 'wave')

    const img = container.querySelector('img')
    expect(img).toBeInTheDocument()
    expect(img?.getAttribute('src')).toMatch(/motion\/03_gesture\/029_wave\.svg$/)
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
    const { container } = render(<MascotActor initialAction="coding" />)
    expect(container.querySelector('[data-mascot-action]')).toHaveAttribute(
      'data-mascot-action',
      'coding',
    )
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toMatch(/motion\/04_work\/043_coding\.svg$/)
  })

  it('dual-buffers motion imgs when crossfade is enabled', () => {
    const { container } = render(<MascotActor size={160} crossfade collapseBottomPad={false} />)
    const wrap = container.querySelector('[data-mascot-crossfade="true"]')
    expect(wrap).toBeInTheDocument()
    const imgs = container.querySelectorAll('img')
    expect(imgs.length).toBe(2)
    expect(imgs[0]?.getAttribute('src')).toMatch(/motion\/03_gesture\/029_wave\.svg$/)
    expect(imgs[1]?.getAttribute('src')).toMatch(/motion\/03_gesture\/029_wave\.svg$/)
  })

  it('keeps front buffer A on mount when crossfade starts on the same clip', () => {
    const { container } = render(
      <MascotActor size={160} crossfade collapseBottomPad={false} initialAction="wave" />,
    )
    const imgs = container.querySelectorAll('img')
    // Layer A is front (opacity 1); no same-src flip to B on mount.
    expect(imgs[0]).toHaveStyle({ opacity: '1' })
    expect(imgs[1]).toHaveStyle({ opacity: '0' })
    expect(container.querySelector('[data-mascot-action]')).toHaveAttribute(
      'data-mascot-action',
      'wave',
    )
  })

  it('dual-buffers with slide transition for left-in right-out', () => {
    const { container } = render(
      <MascotActor size={160} transition="slide" collapseBottomPad={false} />,
    )
    const wrap = container.querySelector('[data-mascot-transition="slide"]')
    expect(wrap).toBeInTheDocument()
    expect(wrap).toHaveClass('overflow-hidden')
    const imgs = container.querySelectorAll('img')
    expect(imgs.length).toBe(2)
    // Front at center; back parked off to the right at rest.
    expect(imgs[0]).toHaveStyle({ opacity: '1', transform: 'translateX(0)' })
    expect(imgs[1]).toHaveStyle({ opacity: '0' })
  })
})
