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
        matches: query.includes('prefers-reduced-motion'),
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

  it('renders promo headline and features without mascot', async () => {
    const { container, getByText } = render(
      <I18nextProvider i18n={i18n}>
        <LoginBrandPanel />
      </I18nextProvider>,
    )

    expect(getByText(i18n.t('login.brandHeadline'))).toBeInTheDocument()
    expect(getByText(i18n.t('login.feature1'))).toBeInTheDocument()
    expect(getByText(i18n.t('login.slogan'))).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-mascot-action]')).toBeNull()

    await waitFor(() => {
      const items = container.querySelectorAll('[data-brand-item]')
      expect(items.length).toBeGreaterThanOrEqual(5)
    })
  })
})
