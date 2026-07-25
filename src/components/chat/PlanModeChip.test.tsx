// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { toast } from 'sonner'
import { PlanModeChip } from './PlanModeChip'
import { useDraftStore } from '@/store/draftStore'
import { useDomainStore } from '@/domain'
import i18n from '@/i18n'

const runPlanOn = vi.fn()
const runInteractive = vi.fn()
const runAutopilot = vi.fn()

vi.mock('sonner', () => ({
  toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() },
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
      disabled,
      ...rest
    }: {
      children: React.ReactNode
      onSelect?: () => void
      disabled?: boolean
      'data-testid'?: string
    }) =>
      React.createElement(
        'div',
        {
          'data-testid': rest['data-testid'] ?? 'dropdown-item',
          'data-disabled': disabled ? 'true' : undefined,
          onClick: () => {
            if (!disabled) onSelect?.()
          },
        },
        children,
      ),
  }
})

vi.mock('@/domain/commands', async () => {
  const actual = await vi.importActual<typeof import('@/domain/commands')>('@/domain/commands')
  return {
    ...actual,
    runPlanOn: (...args: unknown[]) => runPlanOn(...args),
    runInteractive: (...args: unknown[]) => runInteractive(...args),
    runAutopilot: (...args: unknown[]) => runAutopilot(...args),
  }
})

describe('ExecutionModePicker (PlanModeChip export)', () => {
  beforeEach(async () => {
    cleanup()
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
    useDraftStore.setState({ draft: null })
    useDomainStore.setState({
      sessions: [],
      activeSessionId: null,
      connection: 'disconnected',
      hasApiKey: true,
      searchHits: [],
      searching: false,
      mcpStatuses: [],
      pluginInstall: null,
    })
  })

  it('selects plan on draft via menu item', () => {
    useDraftStore.setState({
      draft: { tempId: 't1', mode: 'project', cwd: '/p', text: '', forcePlan: false },
    })
    render(<PlanModeChip />)
    const chip = screen.getByTestId('execution-mode-chip')
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByTestId('execution-mode-plan'))
    expect(runPlanOn).toHaveBeenCalledWith(null)
  })

  it('shows pressed when plan mode active', () => {
    useDraftStore.setState({
      draft: {
        tempId: 't1',
        mode: 'project',
        cwd: '/p',
        text: '',
        forcePlan: true,
        executionMode: 'plan',
      },
    })
    render(<PlanModeChip />)
    expect(screen.getByTestId('execution-mode-chip')).toHaveAttribute('aria-pressed', 'true')
  })

  it('selects plan on session', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: {
            llmProvider: 'deepseek',
            model: 'm',
            tools: [],
            surface: 'code',
            forcePlan: false,
          },
          title: 't',
          preview: '',
          updatedAtMs: 0,
          loaded: true,
          messages: [],
          status: 'idle',
          error: null,
          interrupt: null,
        },
      ],
      activeSessionId: 's1',
    } as never)

    render(<PlanModeChip />)
    fireEvent.click(screen.getByTestId('execution-mode-plan'))
    expect(runPlanOn).toHaveBeenCalledWith('s1')
  })

  it('KD-12: while running, chip is aria-disabled and menu select only toasts', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: {
            llmProvider: 'deepseek',
            model: 'm',
            tools: [],
            surface: 'code',
            forcePlan: false,
          },
          title: 't',
          preview: '',
          updatedAtMs: 0,
          loaded: true,
          messages: [],
          status: 'running',
          error: null,
          interrupt: null,
        },
      ],
      activeSessionId: 's1',
    } as never)

    render(<PlanModeChip />)
    const chip = screen.getByTestId('execution-mode-chip')
    expect(chip).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(chip)
    expect(toast.message).toHaveBeenCalledWith(i18n.t('chat.executionMode.busyTitle'))
    expect(runPlanOn).not.toHaveBeenCalled()
  })

  it('disables autopilot when permission is not full', () => {
    useDraftStore.setState({
      draft: {
        tempId: 't1',
        mode: 'project',
        cwd: '/p',
        text: '',
        permissionMode: 'edit',
      },
    })
    render(<PlanModeChip />)
    expect(screen.getByTestId('execution-mode-autopilot')).toHaveAttribute('data-disabled', 'true')
    fireEvent.click(screen.getByTestId('execution-mode-autopilot'))
    expect(runAutopilot).not.toHaveBeenCalled()
  })

  it('allows autopilot when permission is full', () => {
    useDraftStore.setState({
      draft: {
        tempId: 't1',
        mode: 'project',
        cwd: '/p',
        text: '',
        permissionMode: 'full',
      },
    })
    render(<PlanModeChip />)
    fireEvent.click(screen.getByTestId('execution-mode-autopilot'))
    expect(runAutopilot).toHaveBeenCalledWith(null)
  })
})
