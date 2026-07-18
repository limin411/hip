// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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

const baseAgent: TurnAgent = {
  agentId: 'coder-1',
  role: 'coder',
  reasoning: '',
  tools: [],
  status: 'done',
  output: 'done',
  elapsedMs: 1200,
}

describe('artifact AgentCard', () => {
  beforeEach(() => cleanup())
  afterEach(() => cleanup())

  it('keeps card shell, left role rail, and a single StatusDot (no dual circle)', () => {
    render(<AgentCard agent={baseAgent} live={false} />)
    const card = screen.getByTestId('agent-card')
    expect(card.className).toContain('rounded-lg')
    expect(card.className).toContain('border-l-2')
    expect(card.className).toContain('border-border')
    expect(card.style.borderLeftColor).toBe('var(--role-coder)')

    const header = screen.getByTestId('agent-card-header')
    expect(header).toHaveAttribute('aria-expanded')
    // Exactly one status indicator circle — StatusDot only (no second role circle).
    expect(screen.getByTestId('status-dot-done')).toBeInTheDocument()
    const coloredCircles = header.querySelectorAll('span.h-2.w-2.rounded-full')
    expect(coloredCircles.length).toBe(1)
  })

  it('uses mutually exclusive running wash without fighting border-border', () => {
    render(
      <AgentCard
        agent={{ ...baseAgent, status: 'running', elapsedMs: 0 }}
        live
      />,
    )
    const card = screen.getByTestId('agent-card')
    expect(card.className).toContain('border-accent/40')
    expect(card.className).not.toContain('border-border')
    expect(card.className).toContain('border-l-2')
    // Left rail stays role identity
    expect(card.style.borderLeftColor).toBe('var(--role-coder)')
    expect(screen.getByTestId('status-dot-running')).toBeInTheDocument()
  })

  it('uses danger wash + danger left rail on error', () => {
    render(
      <AgentCard
        agent={{ ...baseAgent, status: 'error', elapsedMs: 0 }}
        live={false}
      />,
    )
    const card = screen.getByTestId('agent-card')
    expect(card.className).toContain('border-danger/40')
    expect(card.className).not.toContain('border-border')
    expect(card.style.borderLeftColor).toBe('var(--danger)')
    expect(screen.getByTestId('status-dot-error')).toBeInTheDocument()
  })
})
