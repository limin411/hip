// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { HipLogo } from './HipLogo'

afterEach(() => {
  cleanup()
})

describe('HipLogo — hero variant', () => {
  it('renders img with src="/logo.svg" and wrapper with role="img" aria-label="hip"', () => {
    const { container } = render(<HipLogo variant="hero" />)

    // Outer wrapper carries role="img" with accessible name
    const wrapper = container.querySelector('[role="img"]')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper).toHaveAttribute('aria-label', 'hip')

    // Inner <img> uses /logo.svg
    const logo = container.querySelector('img[src="/logo.svg"]')
    expect(logo).toBeInTheDocument()
    expect(logo).toHaveAttribute('alt', 'hip')
  })

  it('does NOT render HugMascot inner SVG body (regression)', () => {
    const { container } = render(<HipLogo variant="hero" />)

    // HugMascot's body: ellipse with rx=46, ry=54 — absent from hero output
    const body = container.querySelector('ellipse[rx="46"]')
    expect(body).not.toBeInTheDocument()

    // HugMascot's eyes are <circle> elements; hero's glow SVG has only an <ellipse>
    const circles = container.querySelectorAll('circle')
    expect(circles).toHaveLength(0)
  })

  it('renders aria-hidden="true" and empty alt when decorative', () => {
    const { container } = render(<HipLogo variant="hero" decorative />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveAttribute('aria-hidden', 'true')

    const logo = container.querySelector('img')
    expect(logo).toHaveAttribute('alt', '')
  })
})

describe('HipLogo — non-hero variants', () => {
  it('renders tile variant as SVG with rect', () => {
    const { container } = render(<HipLogo variant="tile" />)

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('role', 'img')
    expect(svg).toHaveAttribute('aria-label', 'hip')

    // tile includes the accent rect background
    expect(container.querySelector('rect')).toBeInTheDocument()
  })

  it('renders minimal variant as SVG with rect (no highlight)', () => {
    const { container } = render(<HipLogo variant="minimal" />)

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('role', 'img')

    // minimal also has the accent rect background
    expect(container.querySelector('rect')).toBeInTheDocument()
  })
})
