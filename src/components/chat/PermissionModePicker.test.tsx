// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { toast } from 'sonner'
import { PermissionModePicker } from './PermissionModePicker'
import { useDraftStore } from '@/store/draftStore'
import { useDomainStore } from '@/domain'
import i18n from '@/i18n'

vi.mock('sonner', () => ({
  toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const setPermissionMode = vi.fn()

vi.mock('@/domain', async () => {
  const actual = await vi.importActual<typeof import('@/domain')>('@/domain')
  return {
    ...actual,
    sessionService: {
      ...actual.sessionService,
      setPermissionMode: (...args: unknown[]) => setPermissionMode(...args),
    },
  }
})

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

describe('PermissionModePicker', () => {
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

  it('selects mode on draft via menu item', () => {
    useDraftStore.setState({
      draft: { tempId: 't1', mode: 'project', cwd: '/p', text: '', permissionMode: 'edit' },
    })
    render(<PermissionModePicker />)
    fireEvent.click(screen.getByTestId('permission-mode-full'))
    expect(useDraftStore.getState().draft?.permissionMode).toBe('full')
    expect(setPermissionMode).not.toHaveBeenCalled()
  })

  it('selects mode on session via menu item', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: {
            llmProvider: 'deepseek',
            model: 'm',
            tools: [],
            surface: 'code',
            permissionMode: 'edit',
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

    render(<PermissionModePicker />)
    fireEvent.click(screen.getByTestId('permission-mode-chat'))
    expect(setPermissionMode).toHaveBeenCalledWith('s1', 'chat')
  })

  it('while running, chip is aria-disabled and menu select only toasts', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: {
            llmProvider: 'deepseek',
            model: 'm',
            tools: [],
            surface: 'code',
            permissionMode: 'edit',
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

    render(<PermissionModePicker />)
    const chip = screen.getByTestId('permission-chip')
    expect(chip).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(chip)
    expect(toast.message).toHaveBeenCalledWith(i18n.t('chat.permission.busyTitle'))
    expect(setPermissionMode).not.toHaveBeenCalled()

    expect(screen.getByTestId('permission-mode-full')).toHaveAttribute('data-disabled', 'true')
    fireEvent.click(screen.getByTestId('permission-mode-full'))
    expect(setPermissionMode).not.toHaveBeenCalled()
  })
})
