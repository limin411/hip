// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import type { Message } from '@hip/protocol'
import { useDomainStore } from '@/domain/sessionStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
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
    DropdownMenuContent: React.forwardRef(function DropdownMenuContentMock(
      {
        children,
        'data-testid': testid,
      }: {
        children: React.ReactNode
        'data-testid'?: string
      },
      _ref: React.Ref<HTMLDivElement>,
    ) {
      return React.createElement('div', { 'data-testid': testid ?? 'dropdown-content' }, children)
    }),
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

    // Permission mode (shared chat PermissionModePicker bound to the terminal
    // session): edit default; pick full → session-scoped write + red border.
    const modeChip = screen.getByTestId('permission-chip')
    expect(modeChip).toHaveTextContent('chat.permission.modes.edit')
    expect(screen.getByTestId('permission-mode-edit')).toHaveAttribute(
      'data-selected',
      'true',
    )
    // Default border; full access turns the composer card red (chat composer parity).
    expect(screen.getByTestId('terminal-composer-card')).toHaveClass('border-border')
    expect(screen.getByTestId('terminal-composer-card')).not.toHaveClass('border-danger-soft')
    // Menu carries the title + per-mode descriptions (chat picker parity).
    expect(screen.getByTestId('permission-mode-menu')).toHaveTextContent(
      'chat.permission.menuTitle',
    )
    expect(screen.getByTestId('permission-mode-edit')).toHaveTextContent(
      'chat.permission.desc.edit',
    )
    const setPermissionMode = vi
      .spyOn(sessionService, 'setPermissionMode')
      .mockImplementation(() => {})
    fireEvent.click(screen.getByTestId('permission-mode-full'))
    expect(setPermissionMode).toHaveBeenCalledWith('ta_1', 'full')
    // Sidecar echo (session:permissionMode) reconciles the store → label + red border.
    act(() => {
      useDomainStore.setState((s) => ({
        sessions: s.sessions.map((x) =>
          x.id === 'ta_1'
            ? { ...x, config: { ...x.config, permissionMode: 'full' as const } }
            : x,
        ),
      }))
    })
    expect(modeChip).toHaveTextContent('chat.permission.modes.full')
    expect(screen.getByTestId('permission-mode-full')).toHaveAttribute(
      'data-selected',
      'true',
    )
    expect(screen.getByTestId('terminal-composer-card')).toHaveClass('border-danger-soft')
    expect(screen.getByTestId('terminal-composer-card')).not.toHaveClass('border-border')
    setPermissionMode.mockRestore()
    setModelFor.mockRestore()
    unmount()
  })

  it('thinking intensity picker (chat parity) binds to the terminal session', () => {
    // Give the session model effort options in the catalog (EffortLevelPicker is
    // catalog-driven and hidden otherwise — same as the chat composer).
    useProvidersStore.setState((s) => ({
      ...s,
      catalog: {
        ...s.catalog,
        openai: {
          ...s.catalog.openai,
          models: {
            ...s.catalog.openai.models,
            'gpt-4o': {
              ...s.catalog.openai.models['gpt-4o'],
              reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
            },
          },
        },
      },
    }))
    useDomainStore.setState((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === 'ta_1'
          ? {
              ...x,
              config: {
                ...x.config,
                llmProvider: 'openai',
                model: 'gpt-4o',
                effort: 'medium',
              },
            }
          : x,
      ),
    }))
    const setEffortSpy = vi.spyOn(sessionService, 'setEffort').mockImplementation(() => {})
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)

    // Chip bound to the terminal session shows its current effort level.
    expect(screen.getByTestId('effort-chip')).toBeInTheDocument()
    expect(screen.getByTestId('effort-chip-label')).toHaveTextContent(
      'chat.effort.levels.medium',
    )
    expect(screen.getByTestId('effort-level-medium')).toHaveAttribute('data-selected', 'true')

    // Picking a level targets the terminal session — never the global active session.
    fireEvent.click(screen.getByTestId('effort-level-high'))
    expect(setEffortSpy).toHaveBeenCalledWith('ta_1', 'high')

    setEffortSpy.mockRestore()
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
          phase: 'running',
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

  it('shows the handoff banner during a handed_off flight and resumes on click', () => {
    useTerminalAgentStore.setState({
      execFlightByTerminal: {
        tm_1: {
          callId: 'c1',
          sessionId: 'ta_1',
          command: 'sudo apt install -y htop',
          startedAt: Date.now(),
          deadline: Date.now() + 120000,
          phase: 'handed_off',
          handedOffAt: Date.now(),
        },
      },
      driverByTerminal: { tm_1: 'user' },
    })
    const resumeSpy = vi.spyOn(useTerminalAgentStore.getState(), 'resumeExecFlight')
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)

    expect(screen.getByTestId('terminal-handoff-banner')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('terminal-handoff-resume'))
    expect(resumeSpy).toHaveBeenCalledWith('tm_1')

    resumeSpy.mockRestore()
    useTerminalAgentStore.setState({ execFlightByTerminal: {}, driverByTerminal: {} })
    unmount()
  })

  it('queues user prompts while an exec flight runs and delivers them when it ends', async () => {    useTerminalAgentStore.setState({
      execFlightByTerminal: {
        tm_1: {
          callId: 'c1',
          sessionId: 'ta_1',
          command: 'npm run build',
          startedAt: Date.now(),
          deadline: Date.now() + 120000,
          phase: 'running',
        },
      },
    })
    const sendSpy = vi.spyOn(sessionService, 'sendMessageToSession').mockImplementation(() => {})
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)
    const input = screen.getByTestId('terminal-composer-input')

    fireEvent.change(input, { target: { value: '顺便把 CHANGELOG 更新了' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Queued, not delivered: chip visible, sidecar untouched.
    expect(screen.getByTestId('terminal-queued-msgs')).toBeInTheDocument()
    expect(sendSpy).not.toHaveBeenCalled()
    expect(input).toHaveValue('')

    // Flight ends → queued prompt is delivered automatically.
    useTerminalAgentStore.setState({ execFlightByTerminal: { tm_1: null } })
    await waitFor(() =>
      expect(sendSpy).toHaveBeenCalledWith('ta_1', '顺便把 CHANGELOG 更新了'),
    )
    expect(screen.queryByTestId('terminal-queued-msgs')).not.toBeInTheDocument()

    sendSpy.mockRestore()
    useTerminalAgentStore.setState({ execFlightByTerminal: {} })
    unmount()
  })

  it('shows the confirm card for a danger prompt and writes a sticky rule on always-allow', async () => {
    useTerminalAgentStore.setState({
      pendingConfirmByTerminal: {
        tm_1: {
          terminalId: 'tm_1',
          kind: 'danger',
          title: 'git push --force origin main',
          resolve: vi.fn(),
        },
      },
    })
    const updateSpy = vi.spyOn(useHipConfigStore.getState(), 'updateSection').mockResolvedValue()
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)

    expect(screen.getByTestId('terminal-confirm-card')).toBeInTheDocument()
    expect(screen.getByText(/git push --force/)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('terminal-confirm-always'))
    expect(updateSpy).toHaveBeenCalledWith('terminal', expect.any(Function))
    const updater = updateSpy.mock.calls[0]?.[1] as (prev: { approveRules?: string[] }) => object
    expect(updater({})).toEqual({ approveRules: ['git push *'] })
    expect(useTerminalAgentStore.getState().pendingConfirmByTerminal.tm_1).toBeNull()

    updateSpy.mockRestore()
    useTerminalAgentStore.setState({ pendingConfirmByTerminal: {} })
    unmount()
  })

  it('confirm-card always-deny writes a deny rule and rejects', () => {
    const resolve = vi.fn()
    useTerminalAgentStore.setState({
      pendingConfirmByTerminal: {
        tm_1: {
          terminalId: 'tm_1',
          kind: 'danger',
          title: 'rm -rf /var/lib/docker',
          resolve,
        },
      },
    })
    const updateSpy = vi.spyOn(useHipConfigStore.getState(), 'updateSection').mockResolvedValue()
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)

    fireEvent.click(screen.getByTestId('terminal-confirm-never'))
    expect(updateSpy).toHaveBeenCalledWith('terminal', expect.any(Function))
    const updater = updateSpy.mock.calls[0]?.[1] as (prev: { denyRules?: string[] }) => object
    expect(updater({})).toEqual({ denyRules: ['rm -rf *'] })
    expect(resolve).toHaveBeenCalledWith({ ok: false, sticky: 'deny' })

    updateSpy.mockRestore()
    useTerminalAgentStore.setState({ pendingConfirmByTerminal: {} })
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

  it('full-access composer shows the gradient flow border while a turn runs', () => {
    useDomainStore.setState((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === 'ta_1'
          ? {
              ...x,
              status: 'running',
              config: { ...x.config, permissionMode: 'full' as const },
            }
          : x,
      ),
    }))
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)
    const card = screen.getByTestId('terminal-composer-card')
    // Turn in flight → animated gradient border (not the idle glow).
    expect(card.className).toContain('composer-danger-flow')
    expect(card.className).not.toContain('composer-danger-glow')
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

  it('does not send on Enter while IME is composing (chat composer parity)', () => {
    const sendSpy = vi.spyOn(sessionService, 'sendMessageToSession').mockImplementation(() => {})
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)
    const input = screen.getByTestId('terminal-composer-input')

    fireEvent.change(input, { target: { value: 'nihao' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false, isComposing: true })
    expect(sendSpy).not.toHaveBeenCalled()
    expect(input).toHaveValue('nihao')

    // Plain Enter still sends.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(sendSpy).toHaveBeenCalledWith('ta_1', 'nihao')

    sendSpy.mockRestore()
    unmount()
  })

  it('shows the plan approval panel and responds per-session (chat PlanProgressPanel parity)', () => {
    useDomainStore.setState((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === 'ta_1'
          ? {
              ...x,
              planApprovalPending: true,
              activeTurnPlan: [
                { id: 'p1', content: 'check disk', status: 'pending' },
              ],
            }
          : x,
      ),
    }))
    const respondSpy = vi
      .spyOn(sessionService, 'respondPlanFor')
      .mockImplementation(() => {})
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)

    // Sticky plan panel above the composer with the pending checklist.
    expect(screen.getByTestId('terminal-plan-slot')).toBeInTheDocument()
    expect(screen.getByTestId('plan-progress-panel')).toHaveAttribute('data-phase', 'awaiting_approval')
    expect(screen.getByText('check disk')).toBeInTheDocument()

    // Approve targets the terminal session — never the global active session.
    fireEvent.click(screen.getByTestId('plan-approve'))
    expect(respondSpy).toHaveBeenCalledWith('ta_1', 'approve')

    // While a plan awaits approval the composer is gated (chat sessionActionBlocked parity).
    expect(screen.getByTestId('terminal-composer-input')).toBeDisabled()

    respondSpy.mockRestore()
    unmount()
  })

  it('hides the plan panel once the plan is approved and the turn is idle', () => {
    useDomainStore.setState((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === 'ta_1'
          ? {
              ...x,
              planApprovalPending: true,
              activeTurnPlan: [{ id: 'p1', content: 'check disk', status: 'pending' }],
            }
          : x,
      ),
    }))
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)
    expect(screen.getByTestId('plan-progress-panel')).toBeInTheDocument()

    // Approved → optimistic dismiss clears the pending flag; the next user turn
    // clears the plan, so the panel hides.
    act(() => {
      useDomainStore.setState((s) => ({
        sessions: s.sessions.map((x) =>
          x.id === 'ta_1'
            ? { ...x, planApprovalPending: false, activeTurnPlan: null }
            : x,
        ),
      }))
    })
    expect(screen.queryByTestId('terminal-plan-slot')).not.toBeInTheDocument()
    unmount()
  })

  it('renders a chat-style interrupt card and Continue resumes the terminal session', () => {
    useDomainStore.setState((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === 'ta_1'
          ? { ...x, interrupt: { turnId: 't1', question: 'confirm proceed?' } }
          : x,
      ),
    }))
    const sendSpy = vi.spyOn(sessionService, 'sendMessageToSession').mockImplementation(() => {})
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)

    const card = screen.getByTestId('terminal-interrupt')
    expect(card).toHaveTextContent('confirm proceed?')
    expect(screen.queryByTestId('terminal-interrupt-continue')).toBeInTheDocument()

    // Continue targets the terminal session — never the global active session.
    fireEvent.click(screen.getByTestId('terminal-interrupt-continue'))
    expect(sendSpy).toHaveBeenCalledWith('ta_1', 'chat.interruptContinueMessage')

    sendSpy.mockRestore()
    unmount()
  })

  it('hides the interrupt card while a plan approval owns the CTA (chat parity)', () => {
    useDomainStore.setState((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === 'ta_1'
          ? {
              ...x,
              planApprovalPending: true,
              activeTurnPlan: [{ id: 'p1', content: 'check disk', status: 'pending' }],
              interrupt: { turnId: 't1', question: 'confirm proceed?' },
            }
          : x,
      ),
    }))
    const { unmount } = render(<TerminalAgentPanel terminalId="tm_1" />)

    expect(screen.queryByTestId('terminal-interrupt')).not.toBeInTheDocument()
    expect(screen.getByTestId('plan-progress-panel')).toBeInTheDocument()
    unmount()
  })
})
