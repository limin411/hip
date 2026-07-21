// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { TurnAgent } from '@/lib/turnAgents'
import { AgentCard } from './AgentCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (sel: (s: { setScrollTarget: (id: string) => void }) => unknown) =>
    sel({ setScrollTarget: vi.fn() }),
}))

vi.mock('@/store/focusStore', () => ({
  useFocusStore: {
    getState: () => ({ setFocusedAgentId: vi.fn() }),
  },
}))

vi.mock('./ToolTrace', () => ({
  ToolTrace: () => <div data-testid="tool-trace" />,
}))

vi.mock('@/components/chat/MarkdownBody', () => ({
  MarkdownBody: ({ content }: { content: string }) => <div data-testid="md-body">{content}</div>,
}))

const baseAgent: TurnAgent = {
  agentId: 'coder-1',
  role: 'coder',
  reasoning: '',
  tools: [],
  status: 'done',
  output: 'result text',
  elapsedMs: 1200,
}

function expandCard() {
  fireEvent.click(screen.getByTestId('agent-card-header'))
}

describe('artifact AgentCard', () => {
  beforeEach(() => cleanup())
  afterEach(() => cleanup())

  it('renders as an open trail row — no card shell or left rail wrap', () => {
    render(<AgentCard agent={baseAgent} live={false} />)
    const card = screen.getByTestId('agent-card')
    // Flat: no rounded card shell, no full border, no left-rail wrap
    expect(card.className).not.toContain('rounded-lg')
    expect(card.className).not.toContain('border-l-2')
    expect(card.className).not.toMatch(/(?:^|\s)border(?:\s|$)/)

    const header = screen.getByTestId('agent-card-header')
    expect(header).toHaveAttribute('aria-expanded')
    // Exactly one status indicator — StatusDot only
    expect(screen.getByTestId('status-dot-done')).toBeInTheDocument()
    expect(header.querySelectorAll('[data-testid^="status-dot-"]').length).toBe(1)
  })

  it('collapses body by default when agent is done (same as supervisor)', () => {
    render(<AgentCard agent={baseAgent} live={false} />)
    expect(screen.getByTestId('agent-card-header')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('agent-card-body')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-output')).not.toBeInTheDocument()
  })

  it('expands body on header click; output stays nested-collapsed when done', () => {
    render(<AgentCard agent={baseAgent} live={false} />)
    expandCard()
    expect(screen.getByTestId('agent-card-header')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('agent-card-body')).toBeInTheDocument()
    const disclosure = screen.getByTestId('agent-output-disclosure')
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('agent-output')).not.toBeInTheDocument()
  })

  it('toggles sub-agent output open and closed', () => {
    render(<AgentCard agent={baseAgent} live={false} />)
    expandCard()
    const disclosure = screen.getByTestId('agent-output-disclosure')

    fireEvent.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('agent-output')).toHaveTextContent('result text')

    fireEvent.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('agent-output')).not.toBeInTheDocument()
  })

  it('stays collapsed while running until user expands', () => {
    render(
      <AgentCard
        agent={{ ...baseAgent, status: 'running', elapsedMs: 0 }}
        live
      />,
    )
    expect(screen.getByTestId('agent-card-header')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('agent-card-body')).not.toBeInTheDocument()

    expandCard()
    expect(screen.getByTestId('agent-card-header')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('agent-card-body')).toBeInTheDocument()
    // Nested output also defaults collapsed
    expect(screen.getByTestId('agent-output-disclosure')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('agent-output')).not.toBeInTheDocument()
  })

  it('lets user collapse a running sub-agent body after expanding', () => {
    render(
      <AgentCard
        agent={{ ...baseAgent, status: 'running', elapsedMs: 0 }}
        live
      />,
    )
    expandCard()
    expect(screen.getByTestId('agent-card-body')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('agent-card-header'))
    expect(screen.getByTestId('agent-card-header')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('agent-card-body')).not.toBeInTheDocument()
  })

  it('does not show output disclosure for supervisor', () => {
    render(
      <AgentCard
        agent={{
          ...baseAgent,
          agentId: 'supervisor',
          role: 'supervisor',
          output: 'should not surface',
        }}
        live={false}
      />,
    )
    expandCard()
    expect(screen.queryByTestId('agent-output-disclosure')).not.toBeInTheDocument()
  })

  it('surfaces error via status text / dot without danger wash wrap', () => {
    render(
      <AgentCard
        agent={{ ...baseAgent, status: 'error', elapsedMs: 0 }}
        live={false}
      />,
    )
    const card = screen.getByTestId('agent-card')
    expect(card.className).not.toMatch(/bg-danger/)
    expect(screen.getByTestId('status-dot-error')).toBeInTheDocument()
  })
})
