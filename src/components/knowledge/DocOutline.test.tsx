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
    // No nested count header — section chrome lives on the panel.
    expect(screen.queryByText(/knowledge\.outline\.count/)).not.toBeInTheDocument()
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

  it('marks active heading for scrollspy', () => {
    render(
      <DocOutline
        content={'# Top\n\n## Nested\n'}
        activeId="nested"
        onSelect={() => {}}
      />,
    )
    expect(screen.getByTestId('knowledge-doc-outline-item-nested')).toHaveAttribute(
      'data-outline-active',
      'true',
    )
    expect(screen.getByTestId('knowledge-doc-outline-item-top')).not.toHaveAttribute(
      'data-outline-active',
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

describe('DocOutline virtualization (V2-P1 T6.1)', () => {
  it('virtualizes beyond 200 headings (renders a window, not all rows)', () => {
    const many = Array.from({ length: 500 }, (_, i) => `## 标题 ${i}`).join('\n')
    const { container } = render(
      <DocOutline content={many} onSelect={() => {}} />,
    )
    expect(container.querySelector('[data-virtual="true"]')).not.toBeNull()
    // 窗口渲染：远少于 500 行。
    const rows = container.querySelectorAll('[data-testid^="knowledge-doc-outline-item-"]')
    expect(rows.length).toBeLessThan(100)
    // 顶部 spacer 存在。
    expect(container.querySelector('li[aria-hidden]')).not.toBeNull()
  })

  it('renders all rows below the threshold (no behavior change)', () => {
    const few = Array.from({ length: 50 }, (_, i) => `## 标题 ${i}`).join('\n')
    const { container } = render(
      <DocOutline content={few} onSelect={() => {}} />,
    )
    expect(container.querySelector('[data-virtual]')).toBeNull()
    expect(
      container.querySelectorAll('[data-testid^="knowledge-doc-outline-item-"]').length,
    ).toBe(50)
  })

  it('scrolling reveals later headings', () => {
    const many = Array.from({ length: 400 }, (_, i) => `## 标题 ${i}`).join('\n')
    const { container } = render(
      <DocOutline content={many} onSelect={() => {}} />,
    )
    const list = container.querySelector('ol')!
    // 模拟滚动到第 300 行（标题索引；行号 = 2*i+1）。
    Object.defineProperty(list, 'clientHeight', { value: 600, configurable: true })
    Object.defineProperty(list, 'scrollTop', { value: 300 * 30, configurable: true, writable: true })
    fireEvent.scroll(list)
    const labels = Array.from(
      container.querySelectorAll('[data-testid^="knowledge-doc-outline-item-"]'),
    ).map((el) => Number(el.getAttribute('data-outline-line')))
    // 窗口内标题行号 ≈ 289–312（标题索引 288–312）。
    expect(labels.some((l) => l >= 289)).toBe(true)
    expect(labels.every((l) => l > 100)).toBe(true)
    expect(labels.length).toBeLessThan(100)
  })
})
