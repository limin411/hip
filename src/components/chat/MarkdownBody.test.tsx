// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }))

import { MarkdownBody } from './MarkdownBody'

describe('MarkdownBody streaming (P0-1)', () => {
  it('renders plain content without stream-chunk spans when not streaming', () => {
    const { container } = render(<MarkdownBody content="plain text" />)
    expect(container.querySelectorAll('.stream-chunk')).toHaveLength(0)
    expect(screen.getByText('plain text')).toBeInTheDocument()
  })

  it('splits paragraph text into stream-chunk spans when streaming', () => {
    const { container } = render(<MarkdownBody streaming content="one two three four" />)
    const chunks = container.querySelectorAll('.stream-chunk')
    expect(chunks.length).toBeGreaterThan(1)
    // textContent 不变 —— span 只包文本不丢字符
    expect(container.textContent).toBe('one two three four')
  })

  it('keeps markdown structure (inline code) intact while streaming', () => {
    const { container } = render(
      <MarkdownBody streaming content="read `src/deps.ts` then verify" />,
    )
    expect(container.querySelector('code')).toHaveTextContent('src/deps.ts')
    expect(container.querySelectorAll('.stream-chunk').length).toBeGreaterThan(1)
  })

  it('leaves non-paragraph blocks (list, pre) un-chunked', () => {
    const { container } = render(
      <MarkdownBody streaming content={'- item one\n- item two\n\n```ts\nconst a = 1\n```'} />,
    )
    expect(container.querySelectorAll('p .stream-chunk').length).toBe(0)
    expect(container.querySelector('li')).toBeInTheDocument()
    expect(container.querySelector('pre')).toBeInTheDocument()
  })
})
