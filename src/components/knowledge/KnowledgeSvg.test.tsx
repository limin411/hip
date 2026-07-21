/**
 * @vitest-environment happy-dom
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { KnowledgeSvg } from './KnowledgeSvg'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
  }),
}))

afterEach(() => cleanup())

describe('KnowledgeSvg', () => {
  it('renders sanitized svg via knowledge-svg testid', () => {
    render(
      <KnowledgeSvg
        code={'<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>'}
      />,
    )
    const el = screen.getByTestId('knowledge-svg')
    expect(el).toBeInTheDocument()
    expect(el.innerHTML.toLowerCase()).toContain('circle')
    expect(el.innerHTML.toLowerCase()).not.toContain('script')
  })

  it('strips script before inject (no raw XSS path)', () => {
    render(
      <KnowledgeSvg
        code={
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>'
        }
      />,
    )
    const el = screen.getByTestId('knowledge-svg')
    expect(el.innerHTML.toLowerCase()).not.toContain('script')
    expect(el.innerHTML).not.toContain('alert')
  })

  it('shows error UI for empty source', () => {
    render(<KnowledgeSvg code="   " />)
    expect(screen.getByTestId('knowledge-svg-error')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-svg-error').dataset.reason).toBe(
      'empty',
    )
    expect(screen.queryByTestId('knowledge-svg')).not.toBeInTheDocument()
  })

  it('shows error UI for oversized payload without injecting raw', () => {
    const huge = `<svg xmlns="http://www.w3.org/2000/svg">${'x'.repeat(200_000)}</svg>`
    render(<KnowledgeSvg code={huge} />)
    const err = screen.getByTestId('knowledge-svg-error')
    expect(err.dataset.reason).toBe('too_large')
    // Must not put the huge raw string into an HTML injection sink as SVG
    expect(screen.queryByTestId('knowledge-svg')).not.toBeInTheDocument()
  })
})
