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

  it('uses role-colored left rail (border-l-2 + ROLE_COLOR)', () => {
    render(<SubAgentCard agent={agent} />)
    const card = screen.getByTestId('subagent-card')
    expect(card.className).toContain('border-l-2')
    expect(card.className).not.toContain('border-border')
    // subagent maps to worker color token
    expect(card.style.borderLeftColor).toBe('var(--role-worker)')
  })

  it('shows role name as secondary meta when taskInput is the title', () => {
    render(<SubAgentCard agent={agent} />)
    const card = screen.getByTestId('subagent-card')
    expect(card).toHaveTextContent('fix bug')
    expect(card).toHaveTextContent('artifact.roles.subagent')
  })

  it('shows concrete agent name instead of generic subagent role when name is set', () => {
    render(<SubAgentCard agent={{ ...agent, name: 'Coder' }} />)
    const card = screen.getByTestId('subagent-card')
    expect(card).toHaveTextContent('fix bug')
    expect(card).toHaveTextContent('Coder')
    expect(card).not.toHaveTextContent('artifact.roles.subagent')
  })

  it('always shows content (no collapse) when agent is done', () => {
    render(<SubAgentCard agent={agent} showTools />)
    const card = screen.getByTestId('subagent-card')
    expect(card).toHaveTextContent('fix bug')
    // SubAgentCard itself is not a collapsible control (ToolCallRow may still expand details)
    expect(card).not.toHaveAttribute('aria-expanded')
    expect(card.tagName).not.toBe('BUTTON')
    expect(screen.getByTestId('subagent-output')).toBeInTheDocument()
    expect(screen.getByTestId('subagent-output')).toHaveTextContent('result text')
    expect(screen.getByTestId('tool-row')).toBeInTheDocument()
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
    const out = screen.getByTestId('subagent-output')
    expect(out.textContent).not.toMatch(/DSML/i)
    expect(out.textContent).toContain('Done')
  })

  it('nests toolCall host inside subAgent; right-click tool → tool items only', async () => {
    render(<SubAgentCard agent={agent} showTools />)

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
