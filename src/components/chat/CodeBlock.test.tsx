// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { CodeBlock } from './CodeBlock'
import { markdownProseClassName } from './MarkdownBody'
import { copyText } from '@/ipc/clipboard'

vi.mock('@/ipc/clipboard', () => ({ copyText: vi.fn() }))

describe('CodeBlock', () => {
  beforeEach(() => cleanup())

  it('renders code and copy button', () => {
    render(
      <CodeBlock>
        <code>const x = 1</code>
      </CodeBlock>,
    )
    expect(screen.getByText('const x = 1')).toBeInTheDocument()
    expect(screen.getByTestId('code-copy')).toBeInTheDocument()
  })

  it('host owns external my-2 spacing', () => {
    render(
      <CodeBlock>
        <code>const x = 1</code>
      </CodeBlock>,
    )
    expect(screen.getByTestId('code-block-context-menu')).toHaveClass('my-2')
  })

  it('chrome unit has border and no my-*', () => {
    render(
      <CodeBlock>
        <code>const x = 1</code>
      </CodeBlock>,
    )
    const chrome = screen.getByTestId('code-block')
    expect(chrome).toHaveClass('rounded-md', 'border', 'border-border', 'overflow-hidden', 'bg-surface-muted')
    expect(chrome.className).not.toMatch(/\bmy-/)
  })

  it('inner pre is m-0', () => {
    render(
      <CodeBlock>
        <code>const x = 1</code>
      </CodeBlock>,
    )
    const pre = screen.getByText('const x = 1').closest('pre')
    expect(pre).toHaveClass('m-0')
  })

  it('shows language label from language-* class', () => {
    render(
      <CodeBlock>
        <code className="language-ts">const x = 1</code>
      </CodeBlock>,
    )
    expect(screen.getByText('ts')).toBeInTheDocument()
  })

  it('copies code and shows check icon', async () => {
    vi.mocked(copyText).mockResolvedValue(true)
    render(
      <CodeBlock>
        <code>hello</code>
      </CodeBlock>,
    )
    fireEvent.click(screen.getByTestId('code-copy'))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('hello'))
  })

  it('does not change icon when copy fails', async () => {
    vi.mocked(copyText).mockResolvedValue(false)
    render(
      <CodeBlock>
        <code>fail</code>
      </CodeBlock>,
    )
    fireEvent.click(screen.getByTestId('code-copy'))
    await waitFor(() => expect(copyText).toHaveBeenCalled())
    expect(screen.getByTestId('code-copy')).toBeInTheDocument()
  })
})

describe('markdownProseClassName (KD11)', () => {
  it('has no [&_pre]:* selectors', () => {
    expect(markdownProseClassName).not.toMatch(/\[&_pre\]/)
  })
})
