/**
 * @vitest-environment happy-dom
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import {
  KnowledgeMermaid,
  __mermaidAppliedThemeForTests,
  __resetMermaidModuleForTests,
} from './KnowledgeMermaid'

const initialize = vi.fn<(config: unknown) => void>()
const renderDiagram = vi.fn<(id: string, code: string) => Promise<{ svg: string }>>(
  async () => ({
    svg: '<svg data-testid="fake-mmd"><text>ok</text></svg>',
  }),
)

vi.mock('mermaid', () => ({
  default: {
    initialize: (config: unknown) => initialize(config),
    render: (id: string, code: string) => renderDiagram(id, code),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
  }),
}))

beforeEach(() => {
  __resetMermaidModuleForTests()
  initialize.mockClear()
  renderDiagram.mockClear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  cleanup()
  document.documentElement.classList.remove('dark')
})

describe('KnowledgeMermaid', () => {
  it('lazy-renders diagram and initializes once with neutral theme', async () => {
    render(<KnowledgeMermaid code={'graph TD\n  A-->B'} />)
    expect(screen.getByTestId('knowledge-mermaid-loading')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('knowledge-mermaid')).toBeInTheDocument()
    })
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'neutral',
      }),
    )
    expect(__mermaidAppliedThemeForTests()).toBe('neutral')
  })

  it('does not re-initialize on code change when theme is unchanged', async () => {
    const { rerender } = render(
      <KnowledgeMermaid code={'graph TD\n  A-->B'} />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('knowledge-mermaid')).toBeInTheDocument()
    })
    expect(initialize).toHaveBeenCalledTimes(1)

    rerender(<KnowledgeMermaid code={'graph TD\n  A-->C'} />)
    await waitFor(() => {
      expect(renderDiagram.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
    expect(initialize).toHaveBeenCalledTimes(1)
  })

  it('uses dark theme when documentElement has dark class', async () => {
    document.documentElement.classList.add('dark')
    render(<KnowledgeMermaid code={'graph TD\n  A-->B'} />)
    await waitFor(() => {
      expect(screen.getByTestId('knowledge-mermaid')).toBeInTheDocument()
    })
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: 'strict',
        theme: 'dark',
      }),
    )
    expect(__mermaidAppliedThemeForTests()).toBe('dark')
  })

  it('re-initializes when dark class is toggled after mount', async () => {
    render(<KnowledgeMermaid code={'graph TD\n  A-->B'} />)
    await waitFor(() => {
      expect(screen.getByTestId('knowledge-mermaid')).toBeInTheDocument()
    })
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(__mermaidAppliedThemeForTests()).toBe('neutral')

    document.documentElement.classList.add('dark')
    await waitFor(() => {
      expect(__mermaidAppliedThemeForTests()).toBe('dark')
    })
    expect(initialize).toHaveBeenCalledTimes(2)
    expect(initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'dark' }),
    )
  })

  it('shows error UI on render failure', async () => {
    renderDiagram.mockRejectedValueOnce(new Error('parse fail'))
    render(<KnowledgeMermaid code={'not valid'} />)
    await waitFor(() => {
      expect(screen.getByTestId('knowledge-mermaid-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('knowledge-mermaid-error').textContent).toContain(
      'parse fail',
    )
  })
})
