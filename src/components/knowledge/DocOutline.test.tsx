// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { DocOutline } from './DocOutline'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

afterEach(() => {
  cleanup()
})

describe('DocOutline', () => {
  it('shows empty state when there are no ATX headings', () => {
    render(<DocOutline content="plain paragraph\n" onSelect={() => {}} />)
    expect(screen.getByTestId('knowledge-doc-outline-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-doc-outline')).not.toBeInTheDocument()
  })

  it('lists headings with level-based indentation and fires onSelect', () => {
    const onSelect = vi.fn()
    render(
      <DocOutline
        content={'# Top\n\n## Nested\n\n### Deep\n'}
        onSelect={onSelect}
      />,
    )
    expect(screen.getByTestId('knowledge-doc-outline')).toBeInTheDocument()
    const top = screen.getByTestId('knowledge-doc-outline-item-top')
    const nested = screen.getByTestId('knowledge-doc-outline-item-nested')
    const deep = screen.getByTestId('knowledge-doc-outline-item-deep')
    expect(top).toHaveAttribute('data-outline-level', '1')
    expect(nested).toHaveAttribute('data-outline-level', '2')
    expect(deep).toHaveAttribute('data-outline-level', '3')
    expect(top).toHaveTextContent('Top')
    fireEvent.click(nested)
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'nested', level: 2, text: 'Nested', line: 3 }),
    )
  })

  it('skips headings inside fenced code blocks', () => {
    render(
      <DocOutline
        content={'## Real\n```\n## Fake\n```\n## After\n'}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByTestId('knowledge-doc-outline-item-real')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-doc-outline-item-after')).toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-doc-outline-item-fake')).not.toBeInTheDocument()
  })
})
