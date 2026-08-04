// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { CodeBlock } from './CodeBlock'
import { markdownProseClassName } from './MarkdownBody'
import { copyText } from '@/ipc/clipboard'
import { highlightCode } from '@/lib/shikiLazy'

vi.mock('@/ipc/clipboard', () => ({ copyText: vi.fn() }))
vi.mock('@/lib/shikiLazy', () => ({
  highlightCode: vi.fn(async () => '<span class="tok">highlighted</span>'),
}))

describe('CodeBlock', () => {
  beforeEach(() => {
    cleanup()
    vi.mocked(highlightCode).mockClear()
  })

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
    expect(chrome).toHaveClass('rounded-lg', 'border', 'border-border', 'overflow-hidden')
    expect(chrome.className).toMatch(/bg-surface-muted/)
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

  it('keeps header strip when language is missing', () => {
    render(
      <CodeBlock>
        <code>plain</code>
      </CodeBlock>,
    )
    const chrome = screen.getByTestId('code-block')
    const copy = screen.getByTestId('code-copy')
    expect(chrome).toContainElement(copy)
    // Empty label still occupies header row (no language text node).
    expect(screen.queryByText(/^(ts|js|tsx|py|rust)$/i)).not.toBeInTheDocument()
    expect(chrome.querySelector('.border-b')).toBeTruthy()
  })

  it('copies code and shows check icon', async () => {
    vi.mocked(copyText).mockResolvedValue(true)
    render(
      <CodeBlock>
        <code>hello</code>
      </CodeBlock>,
    )
    const btn = screen.getByTestId('code-copy')
    expect(btn.querySelector('.lucide-copy')).toBeTruthy()
    fireEvent.click(btn)
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('hello'))
    await waitFor(() => expect(btn.querySelector('.lucide-check')).toBeTruthy())
  })

  it('does not change icon when copy fails', async () => {
    vi.mocked(copyText).mockResolvedValue(false)
    render(
      <CodeBlock>
        <code>fail</code>
      </CodeBlock>,
    )
    const btn = screen.getByTestId('code-copy')
    fireEvent.click(btn)
    await waitFor(() => expect(copyText).toHaveBeenCalled())
    expect(btn.querySelector('.lucide-copy')).toBeTruthy()
    expect(btn.querySelector('.lucide-check')).toBeNull()
  })

  it('defaults syntaxHighlight=false and does not call shiki', () => {
    render(
      <CodeBlock>
        <code className="language-ts">const x = 1</code>
      </CodeBlock>,
    )
    expect(highlightCode).not.toHaveBeenCalled()
    expect(screen.getByText('const x = 1')).toBeInTheDocument()
  })

  it('syntaxHighlight=true lazy-highlights known langs (single-layer code)', async () => {
    render(
      <CodeBlock syntaxHighlight>
        <code className="language-ts">const x = 1</code>
      </CodeBlock>,
    )
    await waitFor(() => expect(highlightCode).toHaveBeenCalled())
    expect(highlightCode).toHaveBeenCalledWith(
      'const x = 1',
      'typescript',
      'follow',
      expect.any(Boolean),
    )
    await waitFor(() => {
      expect(screen.getByText('highlighted')).toBeInTheDocument()
    })
    // Single chrome pre — no nested shiki pre
    const chrome = screen.getByTestId('code-block')
    expect(chrome.querySelectorAll('pre').length).toBe(1)
  })

  it('syntaxHighlight=true with unknown lang stays plain (no toast)', async () => {
    render(
      <CodeBlock syntaxHighlight>
        <code className="language-mermaid">graph TD</code>
      </CodeBlock>,
    )
    // allow effect to run
    await waitFor(() => {
      expect(screen.getByText('graph TD')).toBeInTheDocument()
    })
    expect(highlightCode).not.toHaveBeenCalled()
  })

  it('parses language-c# and language-c++ class tokens for aliases', async () => {
    render(
      <CodeBlock syntaxHighlight>
        <code className="language-c#">var x = 1;</code>
      </CodeBlock>,
    )
    await waitFor(() => expect(highlightCode).toHaveBeenCalled())
    expect(highlightCode).toHaveBeenCalledWith(
      'var x = 1;',
      'csharp',
      'follow',
      expect.any(Boolean),
    )
    cleanup()
    vi.mocked(highlightCode).mockClear()
    render(
      <CodeBlock syntaxHighlight>
        <code className="language-c++">int x = 1;</code>
      </CodeBlock>,
    )
    await waitFor(() => expect(highlightCode).toHaveBeenCalled())
    expect(highlightCode).toHaveBeenCalledWith(
      'int x = 1;',
      'cpp',
      'follow',
      expect.any(Boolean),
    )
  })

  it('shows language badge for c# class names', () => {
    render(
      <CodeBlock>
        <code className="language-c#">x</code>
      </CodeBlock>,
    )
    expect(screen.getByText('c#')).toBeInTheDocument()
  })
})

describe('markdownProseClassName (KD11 + prose contract)', () => {
  it('has no [&_pre]:* selectors', () => {
    expect(markdownProseClassName).not.toMatch(/\[&_pre\]/)
  })

  it('pins full prose hierarchy and denser table/task selectors', () => {
    // Headings h3–h6 (h1/h2 pre-existed; full scale is the PR2 contract)
    expect(markdownProseClassName).toContain('[&_h3]:text-body')
    expect(markdownProseClassName).toContain('[&_h3]:font-semibold')
    expect(markdownProseClassName).toContain('[&_h4]:text-meta')
    expect(markdownProseClassName).toContain('[&_h4]:font-medium')
    expect(markdownProseClassName).toContain('[&_h5]:text-meta')
    expect(markdownProseClassName).toContain('[&_h5]:font-medium')
    expect(markdownProseClassName).toContain('[&_h6]:text-meta')
    expect(markdownProseClassName).toContain('[&_h6]:font-medium')
    expect(markdownProseClassName).toContain('[&_h6]:text-ink-secondary')
    // Display/title headings stay semibold + tracking (editorial, not bold-heavy)
    expect(markdownProseClassName).toContain('[&_h1]:font-semibold')
    expect(markdownProseClassName).toContain('[&_h2]:font-semibold')
    // List rhythm
    expect(markdownProseClassName).toContain('[&_li]:my-0.5')
    expect(markdownProseClassName).toContain('[&_li>p]:my-0.5')
    // Horizontal rule
    expect(markdownProseClassName).toContain('[&_hr]:my-4')
    expect(markdownProseClassName).toContain('[&_hr]:border-t')
    expect(markdownProseClassName).toContain('[&_hr]:border-border')
    // Denser table cells + wrap so column max-width holds
    expect(markdownProseClassName).toContain('[&_th]:px-2.5')
    expect(markdownProseClassName).toContain('[&_th]:py-1.5')
    expect(markdownProseClassName).toContain('[&_th]:text-meta')
    expect(markdownProseClassName).toContain('[&_th]:font-semibold')
    expect(markdownProseClassName).toContain('[&_th]:break-words')
    expect(markdownProseClassName).toContain('[&_td]:px-2.5')
    expect(markdownProseClassName).toContain('[&_td]:py-1.5')
    expect(markdownProseClassName).toContain('[&_td]:text-meta')
    expect(markdownProseClassName).toContain('[&_td]:break-words')
    expect(markdownProseClassName).toContain('[&_table]:table-fixed')
    // GFM task list checkboxes
    expect(markdownProseClassName).toContain('[&_input[type=checkbox]]:mr-2')
    expect(markdownProseClassName).toContain('[&_input[type=checkbox]]:align-middle')
  })
})
