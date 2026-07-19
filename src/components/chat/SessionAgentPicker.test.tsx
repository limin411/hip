// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import type { AgentConfig } from '@hip/protocol'
import { enabledAcpAgents, resolvePrimaryAgentId, SessionAgentPicker } from './SessionAgentPicker'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'composer.agentPicker.label': 'Agent',
        'composer.agentPicker.builtin': 'hip (built-in)',
        'composer.agentPicker.empty': 'No external agents enabled. Add one in Settings.',
      }
      return map[key] ?? key
    },
  }),
}))

vi.mock('lucide-react', () => ({
  Bot: () => React.createElement('span', { 'data-testid': 'icon-bot' }),
  Check: () => React.createElement('span', { 'data-testid': 'icon-check' }),
}))

vi.mock('@/components/ui/DropdownMenu', async () => {
  const React = await import('react')
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'dropdown-menu' }, children),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'dropdown-trigger' }, children),
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'dropdown-content' }, children),
    DropdownMenuItem: ({
      children,
      onSelect,
      ...rest
    }: {
      children: React.ReactNode
      onSelect?: () => void
      'data-testid'?: string
    }) =>
      React.createElement(
        'div',
        { 'data-testid': rest['data-testid'] ?? 'dropdown-item', onClick: onSelect },
        children,
      ),
  }
})

vi.mock('./ComposerChip', () => ({
  ComposerChip: ({
    children,
    title,
    ...rest
  }: {
    children: React.ReactNode
    title?: string
    'data-testid'?: string
  }) =>
    React.createElement(
      'button',
      { 'data-testid': rest['data-testid'] ?? 'composer-chip', title, type: 'button' },
      children,
    ),
}))

const setAgentId = vi.fn()
let mockDraft: { tempId: string; mode: 'chat'; text: string; agentId?: string } | null = null
vi.mock('@/store/draftStore', () => ({
  useDraftStore: (sel: (s: { draft: typeof mockDraft; setAgentId: typeof setAgentId }) => unknown) =>
    sel({ draft: mockDraft, setAgentId }),
}))

let mockAgents: AgentConfig[] = []
vi.mock('@/store/hipConfigStore', () => ({
  useAgents: () => mockAgents,
}))

let mockActiveSessionId: string | null = null
let mockSession: { config: { agentId?: string } } | null = null
vi.mock('@/domain', () => ({
  useActiveSessionId: () => mockActiveSessionId,
  useActiveSession: () => mockSession,
}))

const acp = (id: string, name: string, enabled = true): AgentConfig => ({
  id,
  name,
  kind: 'acp',
  command: 'cmd',
  args: [],
  enabled,
})

describe('enabledAcpAgents / resolvePrimaryAgentId', () => {
  it('filters to enabled ACP only', () => {
    const list = [
      acp('a', 'A'),
      acp('b', 'B', false),
      { ...acp('c', 'C'), kind: 'internal' as const },
    ]
    expect(enabledAcpAgents(list).map((a) => a.id)).toEqual(['a'])
  })
  it('resolvePrimaryAgentId defaults empty to builtin', () => {
    expect(resolvePrimaryAgentId(undefined)).toBe('builtin')
    expect(resolvePrimaryAgentId('')).toBe('builtin')
    expect(resolvePrimaryAgentId('x')).toBe('x')
  })
})

describe('SessionAgentPicker', () => {
  beforeEach(() => {
    cleanup()
    setAgentId.mockClear()
    mockDraft = { tempId: 't1', mode: 'chat', text: '' }
    mockAgents = [acp('opencode', 'OpenCode'), acp('grok', 'Grok Build')]
    mockActiveSessionId = null
    mockSession = null
  })
  afterEach(() => cleanup())

  it('lists builtin + enabled ACP agents on draft', () => {
    render(<SessionAgentPicker />)
    expect(screen.getByTestId('session-agent-chip')).toBeInTheDocument()
    expect(screen.getByTestId('session-agent-option-builtin')).toBeInTheDocument()
    expect(screen.getByTestId('session-agent-option-opencode')).toBeInTheDocument()
    expect(screen.getByTestId('session-agent-option-grok')).toBeInTheDocument()
  })

  it('writes draft.agentId when selecting an ACP agent', () => {
    render(<SessionAgentPicker />)
    fireEvent.click(screen.getByTestId('session-agent-option-opencode'))
    expect(setAgentId).toHaveBeenCalledWith('opencode')
  })

  it('shows empty hint when no ACP agents enabled', () => {
    mockAgents = [acp('x', 'X', false)]
    render(<SessionAgentPicker />)
    expect(screen.getByTestId('session-agent-empty')).toHaveTextContent(/No external agents/)
  })

  it('locks read-only on active session', () => {
    mockActiveSessionId = 's1'
    mockSession = { config: { agentId: 'opencode' } }
    render(<SessionAgentPicker />)
    expect(screen.getByTestId('session-agent-chip-locked')).toBeInTheDocument()
    expect(screen.queryByTestId('session-agent-chip')).not.toBeInTheDocument()
  })
})
