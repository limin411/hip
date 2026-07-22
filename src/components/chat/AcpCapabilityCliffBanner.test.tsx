// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import type { AgentConfig } from '@hip/protocol'
import { AcpCapabilityCliffBanner, useCliffDismissStore } from './AcpCapabilityCliffBanner'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) => {
      if (key === 'chat.acpCliff.body') return `Driven by ${opts?.name ?? ''}`
      const map: Record<string, string> = {
        'chat.acpCliff.title': 'External agent mode',
        'chat.acpCliff.mcpOff': 'MCP off',
        'chat.acpCliff.mcpOn': 'MCP on',
        'chat.acpCliff.dismiss': 'Got it',
      }
      return map[key] ?? key
    },
  }),
}))

vi.mock('lucide-react', () => ({
  AlertTriangle: () => React.createElement('span', { 'data-testid': 'icon-warn' }),
  XCircle: () => React.createElement('span', { 'data-testid': 'icon-danger' }),
  Info: () => React.createElement('span', { 'data-testid': 'icon-info' }),
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

let mockDraft: { tempId: string; mode: 'chat'; text: string; agentId?: string } | null = null
vi.mock('@/store/draftStore', () => ({
  useDraftStore: (sel: (s: { draft: typeof mockDraft }) => unknown) => sel({ draft: mockDraft }),
}))

let mockAgents: AgentConfig[] = []
let mockForwardMcp = false
vi.mock('@/store/hipConfigStore', () => ({
  useAgents: () => mockAgents,
  useHipConfigStore: (sel: (s: { config: { acp?: { forwardMcp?: boolean } } }) => unknown) =>
    sel({ config: { acp: { forwardMcp: mockForwardMcp } } }),
}))

let mockActiveSessionId: string | null = null
let mockSession: { config: { agentId?: string } } | null = null
vi.mock('@/domain', () => ({
  useActiveSessionId: () => mockActiveSessionId,
  useActiveSession: () => mockSession,
}))

describe('AcpCapabilityCliffBanner', () => {
  beforeEach(() => {
    cleanup()
    useCliffDismissStore.setState({ dismissed: {} })
    mockDraft = { tempId: 't1', mode: 'chat', text: '', agentId: 'opencode' }
    mockAgents = [
      {
        id: 'opencode',
        name: 'OpenCode',
        kind: 'acp',
        command: 'opencode',
        args: [],
        enabled: true,
      },
    ]
    mockForwardMcp = false
    mockActiveSessionId = null
    mockSession = null
  })
  afterEach(() => cleanup())

  it('shows on draft when ACP agent selected', () => {
    render(<AcpCapabilityCliffBanner />)
    expect(screen.getByTestId('acp-capability-cliff-banner')).toBeInTheDocument()
    expect(screen.getByText('Driven by OpenCode')).toBeInTheDocument()
    expect(screen.getByText('MCP off')).toBeInTheDocument()
  })

  it('hides for builtin draft', () => {
    mockDraft = { tempId: 't1', mode: 'chat', text: '' }
    render(<AcpCapabilityCliffBanner />)
    expect(screen.queryByTestId('acp-capability-cliff-banner')).not.toBeInTheDocument()
  })

  it('dismisses and stays dismissed for same agent', () => {
    render(<AcpCapabilityCliffBanner />)
    fireEvent.click(screen.getByTestId('acp-cliff-dismiss'))
    expect(screen.queryByTestId('acp-capability-cliff-banner')).not.toBeInTheDocument()
    cleanup()
    render(<AcpCapabilityCliffBanner />)
    expect(screen.queryByTestId('acp-capability-cliff-banner')).not.toBeInTheDocument()
  })

  it('re-shows when agentId changes after dismiss', () => {
    render(<AcpCapabilityCliffBanner />)
    fireEvent.click(screen.getByTestId('acp-cliff-dismiss'))
    cleanup()
    mockDraft = { tempId: 't1', mode: 'chat', text: '', agentId: 'other' }
    mockAgents = [
      {
        id: 'other',
        name: 'Other',
        kind: 'acp',
        command: 'x',
        args: [],
        enabled: true,
      },
    ]
    render(<AcpCapabilityCliffBanner />)
    expect(screen.getByTestId('acp-capability-cliff-banner')).toBeInTheDocument()
  })

  it('shows MCP on copy when forwardMcp is true', () => {
    mockForwardMcp = true
    render(<AcpCapabilityCliffBanner />)
    expect(screen.getByText('MCP on')).toBeInTheDocument()
  })

  it('shows for active external session', () => {
    mockDraft = null
    mockActiveSessionId = 's1'
    mockSession = { config: { agentId: 'opencode' } }
    render(<AcpCapabilityCliffBanner />)
    expect(screen.getByTestId('acp-capability-cliff-banner')).toBeInTheDocument()
  })
})
