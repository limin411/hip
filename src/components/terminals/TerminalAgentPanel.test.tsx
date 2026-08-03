// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Message } from '@hip/protocol'
import { useDomainStore } from '@/domain/sessionStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalAgentStore } from '@/store/terminalAgentStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import { TerminalAgentPanel } from './TerminalAgentPanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: 'zh-CN', language: 'zh-CN' },
  }),
}))

vi.mock('@/store/hipConfigStore', () => ({
  useAgents: () => [],
}))

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    llmProvider: 'minimax-cn-coding-plan',
    model: 'MiniMax-M3',
    tools: [],
    permissionMode: 'edit' as const,
    ...overrides,
  }
}

describe('TerminalAgentPanel tool card collapsing', () => {
  beforeEach(() => {
    useManagedTerminalStore.setState({
      terminals: [
        {
          id: 'tm_1',
          kind: 'ssh',
          title: 'd1',
          hostId: 'hst_1',
          status: 'connected',
          createdAt: 1,
        },
      ],
      focusedId: 'tm_1',
    })
    useTerminalHostStore.setState({
      hosts: [
        {
          id: 'hst_1',
          label: 'd1',
          hostname: '10.0.0.1',
          port: 22,
          username: 'root',
          authMethod: 'password',
          updatedAt: 1,
        },
      ],
      groups: [],
      recents: [],
      terminalRecords: [],
      loaded: true,
      error: null,
    } as never)
    useTerminalAgentStore.setState({
      activeSessionByTerminal: { tm_1: 'ta_1' },
      sidebarExpanded: {},
      execFlightByTerminal: {},
    })
    useDomainStore.setState({
      sessions: [
        {
          id: 'ta_1',
          title: 'ops',
          preview: '',
          updatedAtMs: 1,
          loaded: true,
          messages: [
            {
              id: 'm1',
              role: 'assistant',
              content: 'root partition usage is 55%.',
              timestamp: 1,
              toolCalls: [
                {
                  callId: 'c1',
                  agentId: 'supervisor',
                  name: 'terminal_exec',
                  input: JSON.stringify({ command: 'df -h' }),
                  output: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/vda3  40G  21G  17G  55% /',
                  status: 'finished',
                  seq: 1,
                },
              ],
            },
          ] as Message[],
          status: 'idle',
          error: null,
          config: baseConfig({
            surface: 'terminal',
            managedTerminalId: 'tm_1',
            hostId: 'hst_1',
          }),
        } as never,
      ],
    } as never)
  })

  it('renders terminal_exec collapsed by default and expands on click', () => {
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)
    const card = screen.getByTestId('terminal-tool-card')
    expect(card.getAttribute('data-tool')).toBe('terminal_exec')
    expect(card.getAttribute('data-expanded')).toBe('false')
    // Collapsed: command summary visible, output hidden.
    expect(screen.getByText('df -h')).toBeInTheDocument()
    expect(screen.queryByText(/Filesystem/)).not.toBeInTheDocument()
    // Order: the tool card (execution) renders BEFORE the assistant answer text.
    const answer = screen.getByText(/root partition usage/)
    expect(
      card.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    fireEvent.click(screen.getByTestId('terminal-tool-header'))
    expect(card.getAttribute('data-expanded')).toBe('true')
    expect(screen.getByText(/Filesystem/)).toBeInTheDocument()
    unmount()
  })
})
