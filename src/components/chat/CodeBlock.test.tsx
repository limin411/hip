// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { CodeBlock } from './CodeBlock'
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
