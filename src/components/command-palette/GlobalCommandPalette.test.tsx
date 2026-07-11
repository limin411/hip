// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@/i18n'
import { GlobalCommandPalette } from './GlobalCommandPalette'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain'
import { GLOBAL_COMMAND_PALETTE } from './feature'
import * as domain from '@/domain'

describe('feature flag', () => {
  it('is dark-launched off', () => {
    expect(GLOBAL_COMMAND_PALETTE).toBe(true)
  })
})

describe('GlobalCommandPalette actions and sessions', () => {
  beforeEach(() => {
    cleanup()
    useCommandPaletteStore.setState({ open: false, page: null })
    useUiStore.setState({
      activeView: 'chat',
      theme: 'system',
      chatSessionId: null,
      codeSessionId: null,
      settingsPage: 'general',
    })
    useDomainStore.setState({ sessions: [], activeSessionId: null })
    vi.restoreAllMocks()
  })

  it('renders navigation and actions when open; no flat theme modes', () => {
    useCommandPaletteStore.setState({ open: true })
    render(<GlobalCommandPalette />)
    expect(screen.getByTestId('global-cmd-nav-settings')).toBeInTheDocument()
    expect(screen.getByTestId('global-cmd-nav-chat')).toBeInTheDocument()
    expect(screen.getByTestId('global-cmd-action-new-conversation')).toBeInTheDocument()
    expect(screen.getByTestId('global-cmd-appearance-theme')).toBeInTheDocument()
    expect(screen.queryByTestId('global-cmd-theme-dark')).not.toBeInTheDocument()
    expect(screen.queryByTestId('global-command-palette-empty')).not.toBeInTheDocument()
  })

  it('selecting Settings navigates and closes the palette', () => {
    useCommandPaletteStore.setState({ open: true })
    render(<GlobalCommandPalette />)
    fireEvent.click(screen.getByTestId('global-cmd-nav-settings'))
    expect(useUiStore.getState().activeView).toBe('settings')
    expect(useCommandPaletteStore.getState().open).toBe(false)
  })

  it('openPage theme shows theme options and keepOpen does not close', () => {
    useCommandPaletteStore.getState().openPage('theme')
    render(<GlobalCommandPalette />)
    expect(screen.getByTestId('global-cmd-theme-dark')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('global-cmd-theme-dark'))
    expect(useUiStore.getState().theme).toBe('dark')
    expect(useCommandPaletteStore.getState().open).toBe(true)
  })

  it('back clears page', () => {
    useCommandPaletteStore.getState().openPage('theme')
    render(<GlobalCommandPalette />)
    fireEvent.click(screen.getByTestId('global-command-palette-back'))
    expect(useCommandPaletteStore.getState().page).toBeNull()
    expect(screen.getByTestId('global-cmd-appearance-theme')).toBeInTheDocument()
  })

  it('selecting New conversation calls sessionService.newConversation', () => {
    const spy = vi.spyOn(domain.sessionService, 'newConversation').mockReturnValue(undefined)
    useCommandPaletteStore.setState({ open: true })
    render(<GlobalCommandPalette />)
    fireEvent.click(screen.getByTestId('global-cmd-action-new-conversation'))
    expect(spy).toHaveBeenCalledWith('chat')
    expect(useCommandPaletteStore.getState().open).toBe(false)
  })

  it('filters commands by search', () => {
    useCommandPaletteStore.setState({ open: true })
    render(<GlobalCommandPalette />)
    fireEvent.change(screen.getByTestId('global-command-palette-input'), {
      target: { value: 'settings' },
    })
    expect(screen.getByTestId('global-cmd-nav-settings')).toBeInTheDocument()
    expect(screen.queryByTestId('global-cmd-appearance-theme')).not.toBeInTheDocument()
  })

  it('shows no-results when search matches nothing', () => {
    useCommandPaletteStore.setState({ open: true })
    render(<GlobalCommandPalette />)
    fireEvent.change(screen.getByTestId('global-command-palette-input'), {
      target: { value: 'zzzz-nope' },
    })
    expect(screen.getByTestId('global-command-palette-empty')).toHaveTextContent('No results')
  })

  it('does not show palette content when closed', () => {
    useCommandPaletteStore.setState({ open: false })
    render(<GlobalCommandPalette />)
    expect(screen.queryByTestId('global-command-palette')).not.toBeInTheDocument()
  })

  it('does not list sessions on empty open', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's-new',
          config: { llmProvider: 'openai', model: 'gpt-4o', tools: [], surface: 'chat' },
          title: 'Newest session',
          preview: '',
          updatedAtMs: 999,
          loaded: true,
          messages: [],
          status: 'idle',
          error: null,
        },
      ],
      activeSessionId: null,
    })
    useCommandPaletteStore.setState({ open: true })
    render(<GlobalCommandPalette />)
    expect(screen.queryByTestId('global-cmd-session-s-new')).not.toBeInTheDocument()
  })

  it('lists sessions after search and selects via sessionService.selectSession', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's-old',
          config: { llmProvider: 'openai', model: 'gpt-4o', tools: [], surface: 'chat' },
          title: 'Older',
          preview: '',
          updatedAtMs: 1,
          loaded: true,
          messages: [],
          status: 'idle',
          error: null,
        },
        {
          id: 's-new',
          config: { llmProvider: 'openai', model: 'gpt-4o', tools: [], surface: 'code' },
          title: 'Newest session',
          preview: '',
          updatedAtMs: 999,
          loaded: true,
          messages: [],
          status: 'idle',
          error: null,
        },
      ],
      activeSessionId: null,
    })
    const spy = vi.spyOn(domain.sessionService, 'selectSession').mockReturnValue(undefined)
    useCommandPaletteStore.setState({ open: true })
    render(<GlobalCommandPalette />)

    fireEvent.change(screen.getByTestId('global-command-palette-input'), {
      target: { value: 'session' },
    })
    expect(screen.getByTestId('global-cmd-session-s-new')).toHaveTextContent('Newest session')
    expect(screen.getByTestId('global-cmd-session-s-old')).toHaveTextContent('Older')

    fireEvent.click(screen.getByTestId('global-cmd-session-s-new'))
    expect(spy).toHaveBeenCalledWith('s-new')
    expect(useCommandPaletteStore.getState().open).toBe(false)
  })

  it('settings-model deep-link updates settings page', () => {
    useCommandPaletteStore.setState({ open: true })
    render(<GlobalCommandPalette />)
    fireEvent.click(screen.getByTestId('global-cmd-settings-model'))
    expect(useUiStore.getState().settingsPage).toBe('model')
    expect(useUiStore.getState().activeView).toBe('settings')
    expect(useCommandPaletteStore.getState().open).toBe(false)
  })
})
