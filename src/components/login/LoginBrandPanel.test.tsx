// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/i18n'
import { LoginBrandPanel } from './LoginBrandPanel'

describe('LoginBrandPanel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        // Motion allowed so the public/motion carousel mounts (not static logo.svg).
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

  afterEach(() => {
    cleanup()
  })

  it('renders promo headline, motion carousel, and features without static logo.svg', async () => {
    const { container, getByText } = render(
      <I18nextProvider i18n={i18n}>
        <LoginBrandPanel />
      </I18nextProvider>,
    )

    expect(getByText(i18n.t('login.brandHeadline'))).toBeInTheDocument()
    expect(getByText(i18n.t('login.slogan'))).toBeInTheDocument()
    // public/motion row (3× crossfade stages), not the static logo mark
    expect(container.querySelectorAll('[data-mascot-action]').length).toBe(3)
    expect(container.querySelectorAll('[data-mascot-crossfade="true"]').length).toBe(3)
    expect(container.querySelector('img[src*="/motion/"]')).toBeInTheDocument()
    expect(container.querySelector('img[src="/logo.svg"]')).toBeNull()
    expect(container.querySelectorAll('[data-dust]').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-parallax]').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-feature-index]').length).toBe(0)

    await waitFor(() => {
      const items = container.querySelectorAll('[data-brand-item]')
      expect(items.length).toBeGreaterThanOrEqual(5)
    })
  })

  it('scatters dust under prefers-reduced-motion instead of stacking at origin', async () => {
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

    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <LoginBrandPanel />
      </I18nextProvider>,
    )

    await waitFor(() => {
      const dust = Array.from(container.querySelectorAll<HTMLElement>('[data-dust]'))
      expect(dust.length).toBeGreaterThan(0)
      // GSAP positions via transform; every particle must leave the origin stack.
      const transformed = dust.filter((el) => {
        const t = el.style.transform || ''
        return t.includes('translate') || t.includes('matrix')
      })
      expect(transformed.length).toBe(dust.length)
    })
  })
})

