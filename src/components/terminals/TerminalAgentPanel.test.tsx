// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { Message } from '@hip/protocol'
import { useDomainStore } from '@/domain/sessionStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalAgentStore } from '@/store/terminalAgentStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import { useProvidersStore } from '@/store/providersStore'
import { sessionService } from '@/domain'
import { TerminalAgentPanel } from './TerminalAgentPanel'

const mocks = vi.hoisted(() => ({
  sshWrite: vi.fn(async (_terminalId: string, _data: string) => {}),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: 'zh-CN', language: 'zh-CN' },
  }),
  // sessionService → i18n/index.ts calls i18n.use(initReactI18next)
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/ipc/ssh', () => ({
  sshWrite: (terminalId: string, data: string) => mocks.sshWrite(terminalId, data),
}))

vi.mock('@/components/ui/DropdownMenu', async () => {
  const React = await import('react')
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    DropdownMenuContent: ({
      children,
      'data-testid': testid,
    }: {
      children: React.ReactNode
      'data-testid'?: string
    }) => React.createElement('div', { 'data-testid': testid ?? 'dropdown-content' }, children),
    DropdownMenuItem: ({
      children,
      onSelect,
      ...rest
    }: {
      children: React.ReactNode
      onSelect?: () => void
    }) => React.createElement('div', { ...rest, onClick: () => onSelect?.() }, children),
  }
})

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
    mocks.sshWrite.mockClear()
    // Model switcher (chat/project parity): one enabled provider with two models.
    useProvidersStore.setState({
      catalog: {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          env: ['OPENAI_API_KEY'],
          api: 'https://api.openai.com/v1',
          models: { 'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' }, 'gpt-4o-mini': { id: 'gpt-4o-mini', name: 'GPT-4o mini' } },
        },
      },
      config: {
        providers: { openai: { enabled: true } },
        activeModel: { providerID: 'openai', modelID: 'gpt-4o' },
      },
      keyConfigured: { openai: true },
    })
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

  it('shows jump-to-latest when scrolled away from the bottom and hides on click', () => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: () => {},
      configurable: true,
      writable: true,
    })
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)
    const list = screen.getByTestId('terminal-message-list')
    Object.defineProperty(list, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(list, 'scrollTop', { value: 100, configurable: true })

    fireEvent.scroll(list)
    const jump = screen.getByTestId('jump-to-latest')
    expect(jump).toBeInTheDocument()

    fireEvent.click(jump)
    expect(screen.queryByTestId('jump-to-latest')).not.toBeInTheDocument()
    unmount()
  })

  it('model switcher (chat/project parity) switches the terminal session model', () => {
    const setModelFor = vi
      .spyOn(sessionService, 'setSessionModelFor')
      .mockImplementation(() => {})
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)

    // Model chip bound to the terminal session shows its current model.
    const modelChip = screen.getByTestId('model-chip')
    expect(modelChip).toHaveTextContent('MiniMax-M3')

    // Open the picker: the session model is selected, picking another model
    // calls the session-scoped switch (never the global active session).
    fireEvent.click(modelChip)
    expect(screen.getByTestId('model-picker-popover')).toBeInTheDocument()
    fireEvent.click(screen.getByText('gpt-4o-mini'))
    expect(setModelFor).toHaveBeenCalledWith('ta_1', 'openai/gpt-4o-mini')

    // Permission mode: edit default; pick full → label + selection update.
    // (test t() returns the key; chip shows the localized mode label.)
    const modeChip = screen.getByTestId('terminal-permission-mode')
    expect(modeChip).toHaveTextContent('chat.permission.modes.edit')
    expect(screen.getByTestId('terminal-permission-option-edit')).toHaveAttribute(
      'data-selected',
      'true',
    )
    // Menu carries the title + per-mode descriptions (chat picker parity).
    expect(screen.getByTestId('terminal-permission-mode-menu')).toHaveTextContent(
      'chat.permission.menuTitle',
    )
    expect(screen.getByTestId('terminal-permission-option-edit')).toHaveTextContent(
      'chat.permission.desc.edit',
    )
    fireEvent.click(screen.getByTestId('terminal-permission-option-full'))
    expect(modeChip).toHaveTextContent('chat.permission.modes.full')
    expect(screen.getByTestId('terminal-permission-option-full')).toHaveAttribute(
      'data-selected',
      'true',
    )
    setModelFor.mockRestore()
    unmount()
  })

  it('does not offer ACP/external agents in the ops composer (builtin hip only)', () => {
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)
    expect(screen.queryByTestId('terminal-agent-picker')).not.toBeInTheDocument()
    expect(screen.queryByTestId('terminal-acp-limited')).not.toBeInTheDocument()
    unmount()
  })

  it('shows the slash palette for /compact and runs it instead of sending a prompt', () => {
    const compactSpy = vi.spyOn(sessionService, 'compactSession').mockImplementation(() => {})
    const sendSpy = vi.spyOn(sessionService, 'sendMessageToSession').mockImplementation(() => {})
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)
    const input = screen.getByTestId('terminal-composer-input')

    // Typing "/" opens the chat-style slash palette listing /compact.
    fireEvent.change(input, { target: { value: '/comp' } })
    expect(screen.getByTestId('slash-palette')).toBeInTheDocument()
    expect(screen.getByTestId('slash-cmd-compact')).toBeInTheDocument()

    // Enter selects /compact from the palette and fills the command text.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('/compact ')

    // Add a focus and submit — runs compaction, never sends a prompt.
    fireEvent.change(input, { target: { value: '/compact auth flow' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(compactSpy).toHaveBeenCalledWith('ta_1', 'auth flow')
    expect(sendSpy).not.toHaveBeenCalled()
    expect(input).toHaveValue('')
    compactSpy.mockRestore()
    sendSpy.mockRestore()
    unmount()
  })

  it('Tab completes /compact in the composer without running it', () => {
    const compactSpy = vi.spyOn(sessionService, 'compactSession').mockImplementation(() => {})
    const sendSpy = vi.spyOn(sessionService, 'sendMessageToSession').mockImplementation(() => {})
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)
    const input = screen.getByTestId('terminal-composer-input')

    // Typing "/comp" opens the slash palette with /compact highlighted.
    fireEvent.change(input, { target: { value: '/comp' } })
    expect(screen.getByTestId('slash-cmd-compact')).toBeInTheDocument()

    // Tab fills the command text; compaction must NOT run yet.
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(input).toHaveValue('/compact ')
    expect(compactSpy).not.toHaveBeenCalled()
    expect(sendSpy).not.toHaveBeenCalled()

    compactSpy.mockRestore()
    sendSpy.mockRestore()
    unmount()
  })

  it('shows the session token usage chip once a turn reports usage', () => {
    useDomainStore.setState((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === 'ta_1' && x.messages[0]
          ? {
              ...x,
              messages: [
                {
                  ...x.messages[0],
                  usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
                },
              ],
            }
          : x,
      ),
    }))
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)
    const chip = screen.getByTestId('terminal-session-usage')
    expect(chip).toBeInTheDocument()
    expect(chip.textContent?.length ?? 0).toBeGreaterThan(0)

    // Hovering the chip opens the usage/cost popover (chat TokenUsageChip parity).
    vi.useFakeTimers()
    fireEvent.mouseEnter(chip)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.getByTestId('terminal-session-usage-popover')).toBeInTheDocument()
    vi.useRealTimers()
    unmount()
  })

  it('shows a stop button during an exec flight that interrupts the command', () => {
    useTerminalAgentStore.setState({
      execFlightByTerminal: {
        tm_1: {
          callId: 'c1',
          sessionId: 'ta_1',
          command: 'tail -f /var/log/x.log',
          startedAt: 1,
          deadline: Date.now() + 15000,
        },
      },
    })
    const cancelSpy = vi
      .spyOn(sessionService, 'cancelSessionTurn')
      .mockImplementation(() => {})
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)

    expect(screen.getByTestId('terminal-composer-stop')).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-composer-send')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('terminal-composer-stop'))
    expect(mocks.sshWrite).toHaveBeenCalledWith('tm_1', '\x03')
    expect(cancelSpy).toHaveBeenCalledWith('ta_1')

    cancelSpy.mockRestore()
    useTerminalAgentStore.setState({ execFlightByTerminal: {} })
    unmount()
  })

  it('shows a stop button during plain agent output (no flight) and only cancels the turn', () => {
    useDomainStore.setState((s) => ({
      sessions: s.sessions.map((x) => (x.id === 'ta_1' ? { ...x, status: 'running' } : x)),
    }))
    const cancelSpy = vi
      .spyOn(sessionService, 'cancelSessionTurn')
      .mockImplementation(() => {})
    mocks.sshWrite.mockClear()
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)

    expect(screen.getByTestId('terminal-composer-stop')).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-composer-send')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('terminal-composer-stop'))
    expect(cancelSpy).toHaveBeenCalledWith('ta_1')
    expect(mocks.sshWrite).not.toHaveBeenCalled()

    cancelSpy.mockRestore()
    unmount()
  })

  it('sends unknown slash text (e.g. /compcat typo) as a normal message', () => {
    const sendSpy = vi.spyOn(sessionService, 'sendMessageToSession').mockImplementation(() => {})
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)
    const input = screen.getByTestId('terminal-composer-input')

    fireEvent.change(input, { target: { value: '/compcat' } })
    expect(screen.getByTestId('slash-palette')).toBeInTheDocument()
    expect(screen.getByTestId('slash-palette-empty')).toBeInTheDocument()

    // Enter with no matching command falls through to the composer and sends
    // the raw text instead of being silently swallowed.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(sendSpy).toHaveBeenCalledWith('ta_1', '/compcat')

    sendSpy.mockRestore()
    unmount()
  })
})
