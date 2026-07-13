// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import '@/i18n'
import type { TurnAgent } from '@/lib/turnAgents'
import { SubAgentCard } from './SubAgentCard'
import { clearContextProviders } from '@/components/context-menu'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  }
})

const agent: TurnAgent = {
  agentId: 'worker-1',
  role: 'subagent',
  reasoning: 'thinking',
  tools: [
    {
      callId: 'c1',
      agentId: 'worker-1',
      name: 'read_file',
      input: '{"path":"src/a.ts"}',
      output: '{"ok":true}',
      status: 'finished',
      seq: 1,
    },
  ],
  status: 'done',
  output: 'result text',
  elapsedMs: 12,
  taskInput: 'fix bug',
  parentAgentId: 'supervisor',
}

describe('SubAgentCard context menu', () => {
  beforeEach(() => {
    cleanup()
    clearContextProviders()
  })

  afterEach(() => {
    clearContextProviders()
    cleanup()
  })

  it('wraps card with subAgent context menu host', () => {
    render(<SubAgentCard agent={agent} />)
    const host = document.querySelector('[data-context-menu-kind="subAgent"]')
    expect(host).toBeTruthy()
    expect(host).toHaveAttribute('data-context-menu-root')
    expect(screen.getByTestId('subagent-card')).toBeInTheDocument()
  })

  it('defaults to collapsed when agent is done', () => {
    render(<SubAgentCard agent={agent} />)
    expect(screen.getByTestId('subagent-card')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('subagent-card')).toHaveTextContent('fix bug')
  })

  it('strips DSML from expanded output', () => {
    const dirty =
      'Done.<｜｜DSML｜｜tool_calls>\n</｜｜DSML｜｜tool_calls>'
    render(
      <SubAgentCard
        agent={{
          ...agent,
          output: dirty,
        }}
      />,
    )
    fireEvent.click(screen.getByTestId('subagent-card'))
    const out = screen.getByTestId('subagent-output')
    expect(out.textContent).not.toMatch(/DSML/i)
    expect(out.textContent).toContain('Done')
  })

  it('nests toolCall host inside subAgent; right-click tool → tool items only', async () => {
    render(<SubAgentCard agent={agent} showTools />)

    fireEvent.click(screen.getByTestId('subagent-card'))

    const toolHost = document.querySelector('[data-context-menu-kind="toolCall"]')
    expect(toolHost).toBeTruthy()
    expect(toolHost!.closest('[data-context-menu-kind="subAgent"]')).toBeTruthy()

    fireEvent.contextMenu(toolHost!)

    await waitFor(() => {
      expect(screen.getByTestId('context-menu-item-toolCall.copyInput')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('context-menu-item-subAgent.copyId')).not.toBeInTheDocument()
    // Single menu content root (no dual-open)
    expect(screen.getAllByTestId('context-menu-content')).toHaveLength(1)
  })

  it('right-click subAgent chrome → subAgent items only (not toolCall)', async () => {
    render(<SubAgentCard agent={agent} />)

    const cardHeader = screen.getByTestId('subagent-card')
    fireEvent.contextMenu(cardHeader)

    await waitFor(() => {
      expect(screen.getByTestId('context-menu-item-subAgent.copyId')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('context-menu-item-toolCall.copyInput')).not.toBeInTheDocument()
  })
})
