// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { ProviderLogo } from './ProviderLogo'

afterEach(() => {
  cleanup()
})

const LOGO_BASE = 'https://logo.test/logos'

describe('ProviderLogo', () => {
  it('renders letter only for custom providers (no img)', () => {
    render(
      <ProviderLogo
        providerId="my-proxy"
        name="My Proxy"
        custom
        logoBase={LOGO_BASE}
      />,
    )
    expect(screen.getByTestId('provider-logo-fallback')).toHaveTextContent('M')
    expect(screen.queryByTestId('provider-logo-img')).toBeNull()
  })

  it('renders letter only when id is path-like', () => {
    render(
      <ProviderLogo providerId="a/b" name="Bad" logoBase={LOGO_BASE} />,
    )
    expect(screen.getByTestId('provider-logo-fallback')).toHaveTextContent('B')
    expect(screen.queryByTestId('provider-logo-img')).toBeNull()
  })

  it('mounts img with correct src for catalog provider', () => {
    render(
      <ProviderLogo
        providerId="openai"
        name="OpenAI"
        logoBase={LOGO_BASE}
      />,
    )
    // Pending: letter underlay + img present but not yet loaded
    expect(screen.getByTestId('provider-logo-fallback')).toHaveTextContent('O')
    const img = screen.getByTestId('provider-logo-img') as HTMLImageElement
    expect(img).toHaveAttribute('src', `${LOGO_BASE}/openai.svg`)
    expect(img).toHaveAttribute('data-provider-id', 'openai')
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('shows letter underlay until onLoad, then marks loaded', () => {
    render(
      <ProviderLogo
        providerId="anthropic"
        name="Anthropic"
        logoBase={LOGO_BASE}
      />,
    )
    expect(screen.getByTestId('provider-logo-fallback')).toBeInTheDocument()
    const img = screen.getByTestId('provider-logo-img')
    fireEvent.load(img)
    expect(screen.getByTestId('provider-logo')).toBeInTheDocument()
    expect(screen.queryByTestId('provider-logo-fallback')).toBeNull()
  })

  it('onError falls back to letter only', () => {
    render(
      <ProviderLogo
        providerId="openai"
        name="OpenAI"
        logoBase={LOGO_BASE}
      />,
    )
    fireEvent.error(screen.getByTestId('provider-logo-img'))
    expect(screen.getByTestId('provider-logo-fallback')).toHaveTextContent('O')
    expect(screen.queryByTestId('provider-logo-img')).toBeNull()
  })

  it('clears failed state when providerId / src changes', () => {
    const { rerender } = render(
      <ProviderLogo
        providerId="openai"
        name="OpenAI"
        logoBase={LOGO_BASE}
      />,
    )
    fireEvent.error(screen.getByTestId('provider-logo-img'))
    expect(screen.queryByTestId('provider-logo-img')).toBeNull()

    rerender(
      <ProviderLogo
        providerId="anthropic"
        name="Anthropic"
        logoBase={LOGO_BASE}
      />,
    )
    // New src → img remounted (failed reset)
    const img = screen.getByTestId('provider-logo-img') as HTMLImageElement
    expect(img).toHaveAttribute('src', `${LOGO_BASE}/anthropic.svg`)
    expect(screen.getByTestId('provider-logo-fallback')).toHaveTextContent('A')
  })

  it('uses name initial when name is empty falls back to providerId', () => {
    render(
      <ProviderLogo providerId="xai" name="" custom logoBase={LOGO_BASE} />,
    )
    expect(screen.getByTestId('provider-logo-fallback')).toHaveTextContent('X')
  })

  it('applies call-site className for surface tokens', () => {
    render(
      <ProviderLogo
        providerId="openai"
        name="OpenAI"
        className="bg-accent-subtle text-accent-strong"
        logoBase={LOGO_BASE}
      />,
    )
    const root = screen.getByTestId('provider-logo-fallback')
    expect(root.className).toMatch(/bg-accent-subtle/)
    expect(root.className).toMatch(/text-accent-strong/)
  })
})
