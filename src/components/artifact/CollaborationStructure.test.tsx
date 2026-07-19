// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { TurnAgent } from '@/lib/turnAgents'
import { CollaborationStructure } from './CollaborationStructure'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => {
      const map: Record<string, string> = {
        'artifact.collaborationStructure': 'Collaboration',
        'artifact.subAgents': 'Sub-agents',
        'artifact.statusRunning': 'running',
        'artifact.roles.supervisor': 'Supervisor',
        'artifact.roles.coder': 'Coder',
        'artifact.roles.worker': 'Worker',
        'artifact.roles.planner': 'Planner',
        'artifact.roles.reviewer': 'Reviewer',
        'artifact.roles.subagent': 'Sub-agent',
      }
      if (key === 'artifact.subAgentCount') return `${opts?.count ?? 0} sub-agents`
      return map[key] ?? key
    },
  }),
}))

function agent(partial: Partial<TurnAgent> & Pick<TurnAgent, 'agentId' | 'role'>): TurnAgent {
  return {
    reasoning: '',
    tools: [],
    status: 'done',
    output: '',
    elapsedMs: 0,
    ...partial,
  }
}

describe('CollaborationStructure', () => {
  afterEach(() => cleanup())

  it('renders nothing when only supervisor is present (D2 hide)', () => {
    const { container } = render(
      <CollaborationStructure
        agents={[agent({ agentId: 'supervisor', role: 'supervisor', status: 'running' })]}
        live
      />,
    )
    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('collaboration-structure')).toBeNull()
  })

  it('expands structure when sub-agents exist', () => {
    render(
      <CollaborationStructure
        agents={[
          agent({ agentId: 'supervisor', role: 'supervisor', status: 'running' }),
          agent({
            agentId: 'coder-1',
            role: 'coder',
            status: 'running',
            taskInput: 'implement feature X',
            parentAgentId: 'supervisor',
          }),
        ]}
        live
      />,
    )
    expect(screen.getByTestId('collaboration-structure')).toBeInTheDocument()
    expect(screen.getByText('Collaboration')).toBeInTheDocument()
    expect(screen.getByText('Supervisor')).toBeInTheDocument()
    expect(screen.getByText('Coder')).toBeInTheDocument()
    expect(screen.getByText('implement feature X')).toBeInTheDocument()
  })

  it('shows concrete agent name for role=subagent when name is set', () => {
    render(
      <CollaborationStructure
        agents={[
          agent({ agentId: 'supervisor', role: 'supervisor' }),
          agent({
            agentId: 'subagent-1',
            role: 'subagent',
            name: 'Explore',
            taskInput: 'find callers',
            parentAgentId: 'supervisor',
          }),
        ]}
        live={false}
      />,
    )
    expect(screen.getByText('Explore')).toBeInTheDocument()
    expect(screen.queryByText('Sub-agent')).not.toBeInTheDocument()
  })
})
