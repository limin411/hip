// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import type { AgentConfig } from '@hip/protocol'
import { enabledAcpAgents, resolvePrimaryAgentId, SessionAgentPicker } from './SessionAgentPicker'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) => {
      const map: Record<string, string> = {
        'composer.agentPicker.label': 'Agent',
        'composer.agentPicker.builtin': 'hip (built-in)',
        'composer.agentPicker.empty': 'No external agents enabled. Add one in Settings.',
        'composer.agentSwitch.title': 'Switch agent?',
        'composer.agentSwitch.body': 'Switching restarts external context.',
        'composer.agentSwitch.target': `Switch to ${opts?.name ?? ''}`,
        'composer.agentSwitch.thisSession': 'Switch this session',
        'composer.agentSwitch.newSession': 'New session',
        'composer.agentSwitch.cancel': 'Cancel',
        'composer.agentSwitch.busy': 'Cannot switch agent while a turn is running',
        'common.close': 'Close',
      }
      return map[key] ?? key
    },
  }),
}))

vi.mock('lucide-react', () => ({
  Bot: () => React.createElement('span', { 'data-testid': 'icon-bot' }),
  Check: () => React.createElement('span', { 'data-testid': 'icon-check' }),
  X: () => React.createElement('span', { 'data-testid': 'icon-x' }),
}))

vi.mock('@/components/ui/DropdownMenu', async () => {
  const React = await import('react')
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'dropdown-menu' }, children),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'dropdown-trigger' }, children),
    DropdownMenuContent: ({
      children,
      ...rest
    }: {
      children: React.ReactNode
      'data-testid'?: string
    }) =>
      React.createElement(
        'div',
        { 'data-testid': rest['data-testid'] ?? 'dropdown-content' },
        children,
      ),
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

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({
    open,
    title,
    children,
    footer,
  }: {
    open: boolean
    title: string
    children: React.ReactNode
    footer?: React.ReactNode
  }) =>
    open
      ? React.createElement(
          'div',
          { 'data-testid': 'modal', 'data-title': title },
          children,
          footer,
        )
      : null,
}))

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    ...rest
  }: {
    children: React.ReactNode
    onClick?: () => void
    'data-testid'?: string
  }) =>
    React.createElement(
      'button',
      { type: 'button', onClick, 'data-testid': rest['data-testid'] },
      children,
    ),
}))

vi.mock('./ComposerChip', () => ({
  ComposerChip: ({
    children,
    title,
    disabled,
    ...rest
  }: {
    children: React.ReactNode
    title?: string
    disabled?: boolean
    'data-testid'?: string
  }) =>
    React.createElement(
      'button',
      {
        'data-testid': rest['data-testid'] ?? 'composer-chip',
        title,
        type: 'button',
        disabled: !!disabled,
      },
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

const setAgent = vi.fn()
const createSession = vi.fn(() => 'new-s')
vi.mock('@/domain', () => ({
  useActiveSessionId: () => mockActiveSessionId,
  useActiveSession: () => mockSession,
  sessionService: {
    setAgent: (...args: unknown[]) => setAgent(...args),
    createSession: (...args: unknown[]) => createSession(...args),
  },
}))

let mockActiveSessionId: string | null = null
let mockSession: { config: { llmProvider: string; model: string; tools: string[]; agentId?: string } } | null = null

const acp = (id: string, name: string, enabled = true, kind: AgentConfig['kind'] = 'acp'): AgentConfig => ({
  id,
  name,
  kind,
  command: 'cmd',
  args: [],
  enabled,
})

describe('enabledAcpAgents / resolvePrimaryAgentId', () => {
  it('filters to enabled acp + legacy opencode', () => {
    const list = [
      acp('a', 'A'),
      acp('b', 'B', false),
      acp('c', 'C', true, 'internal'),
      acp('d', 'Legacy', true, 'opencode'),
    ]
    expect(enabledAcpAgents(list).map((a) => a.id)).toEqual(['a', 'd'])
  })
  it('resolvePrimaryAgentId defaults empty to builtin', () => {
    expect(resolvePrimaryAgentId(undefined)).toBe('builtin')
    expect(resolvePrimaryAgentId('')).toBe('builtin')
    expect(resolvePrimaryAgentId('  ')).toBe('builtin')
    expect(resolvePrimaryAgentId('x')).toBe('x')
  })
})

describe('SessionAgentPicker', () => {
  beforeEach(() => {
    cleanup()
    setAgentId.mockClear()
    setAgent.mockClear()
    createSession.mockClear()
    mockDraft = { tempId: 't1', mode: 'chat', text: '' }
    mockAgents = [acp('opencode', 'OpenCode'), acp('grok', 'Grok Build'), acp('legacy', 'Old OC', true, 'opencode')]
    mockActiveSessionId = null
    mockSession = null
  })
  afterEach(() => cleanup())

  it('lists builtin + enabled ACP and legacy opencode agents on draft', () => {
    render(<SessionAgentPicker />)
    expect(screen.getByTestId('session-agent-chip')).toBeInTheDocument()
    expect(screen.getByTestId('session-agent-option-builtin')).toBeInTheDocument()
    expect(screen.getByTestId('session-agent-option-opencode')).toBeInTheDocument()
    expect(screen.getByTestId('session-agent-option-grok')).toBeInTheDocument()
    expect(screen.getByTestId('session-agent-option-legacy')).toBeInTheDocument()
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

  it('unlocks on active session and confirms mid-switch via setAgent', () => {
    mockActiveSessionId = 's1'
    mockSession = { config: { llmProvider: 'deepseek', model: 'm', tools: [], agentId: undefined } }
    render(<SessionAgentPicker />)
    expect(screen.getByTestId('session-agent-chip-active')).toBeInTheDocument()
    expect(screen.getByTestId('session-agent-menu')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('session-agent-option-opencode'))
    expect(screen.getByTestId('session-agent-switch-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('session-agent-switch-this'))
    expect(setAgent).toHaveBeenCalledWith('s1', 'opencode')
    expect(setAgentId).not.toHaveBeenCalled()
  })

  it('new session option forks createSession with agentId', () => {
    mockActiveSessionId = 's1'
    mockSession = { config: { llmProvider: 'deepseek', model: 'm', tools: [], agentId: undefined } }
    render(<SessionAgentPicker />)
    fireEvent.click(screen.getByTestId('session-agent-option-grok'))
    fireEvent.click(screen.getByTestId('session-agent-switch-new'))
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'grok', llmProvider: 'deepseek' }),
    )
    expect(setAgent).not.toHaveBeenCalled()
  })

  it('cancel closes dialog without switching', () => {
    mockActiveSessionId = 's1'
    mockSession = { config: { llmProvider: 'deepseek', model: 'm', tools: [] } }
    render(<SessionAgentPicker />)
    fireEvent.click(screen.getByTestId('session-agent-option-opencode'))
    fireEvent.click(screen.getByTestId('session-agent-switch-cancel'))
    expect(setAgent).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
    expect(screen.queryByTestId('session-agent-switch-dialog')).not.toBeInTheDocument()
  })

  it('does not open dialog when re-selecting current agent', () => {
    mockActiveSessionId = 's1'
    mockSession = { config: { llmProvider: 'deepseek', model: 'm', tools: [], agentId: 'opencode' } }
    render(<SessionAgentPicker />)
    fireEvent.click(screen.getByTestId('session-agent-option-opencode'))
    expect(screen.queryByTestId('session-agent-switch-dialog')).not.toBeInTheDocument()
  })
})
