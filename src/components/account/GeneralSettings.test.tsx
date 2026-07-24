// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { GeneralSettings } from './GeneralSettings'

const updateSection = vi.fn().mockResolvedValue(undefined)
const load = vi.fn().mockResolvedValue(undefined)

const hipConfigState = {
  config: {
    version: 1 as const,
    terminal: { shell: 'default' as const, colorTheme: 'follow' as const },
  },
  loaded: true,
  load,
  updateSection,
}

vi.mock('@/store/hipConfigStore', () => ({
  useHipConfigStore: (sel: (s: typeof hipConfigState) => unknown) => sel(hipConfigState),
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      language: 'en',
      setLanguage: vi.fn(),
      theme: 'system',
      setTheme: vi.fn(),
      density: 'comfortable',
      setDensity: vi.fn(),
    }),
}))

vi.mock('@/lib/platform', () => ({
  detectHipPlatform: () => 'windows',
}))

vi.mock('@/components/context-menu/feature', () => ({
  CONTEXT_MENUS: false,
}))

vi.mock('@/components/ui/DropdownMenu', async () => {
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) =>
      React.createElement(React.Fragment, null, children),
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
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
        'button',
        { type: 'button', onClick: () => onSelect?.(), ...rest },
        children,
      ),
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('GeneralSettings terminal shell', () => {
  beforeEach(() => {
    updateSection.mockClear()
    load.mockClear()
    hipConfigState.config.terminal = { shell: 'default', colorTheme: 'follow' }
  })
  afterEach(() => {
    cleanup()
  })

  it('renders default terminal control on Windows', () => {
    render(<GeneralSettings />)
    const row = screen.getByTestId('settings-terminal-shell')
    expect(row).toBeInTheDocument()
    expect(within(row).getByTestId('settings-terminal-shell-trigger')).toHaveTextContent(
      'settings.terminalShells.default',
    )
  })

  it('persists shell preference via functional merge', async () => {
    render(<GeneralSettings />)
    fireEvent.click(screen.getByTestId('settings-terminal-shell-powershell'))
    await waitFor(() => {
      expect(updateSection).toHaveBeenCalledWith('terminal', expect.any(Function))
    })
    const updater = updateSection.mock.calls[0][1] as (prev: {
      shell?: string
      colorTheme?: string
    }) => { shell?: string; colorTheme?: string }
    expect(updater({ shell: 'default', colorTheme: 'dracula' })).toEqual({
      shell: 'powershell',
      colorTheme: 'dracula',
    })
  })
})

describe('GeneralSettings terminal color', () => {
  beforeEach(() => {
    updateSection.mockClear()
    load.mockClear()
    hipConfigState.config.terminal = { shell: 'default', colorTheme: 'follow' }
  })
  afterEach(() => {
    cleanup()
  })

  it('renders terminal color control', () => {
    render(<GeneralSettings />)
    const row = screen.getByTestId('settings-terminal-color')
    expect(row).toBeInTheDocument()
    expect(within(row).getByTestId('settings-terminal-color-trigger')).toHaveTextContent(
      'settings.terminalColors.follow',
    )
  })

  it('persists colorTheme via functional merge and preserves shell', async () => {
    render(<GeneralSettings />)
    fireEvent.click(screen.getByTestId('settings-terminal-color-dracula'))
    await waitFor(() => {
      expect(updateSection).toHaveBeenCalledWith('terminal', expect.any(Function))
    })
    const updater = updateSection.mock.calls[0][1] as (prev: {
      shell?: string
      colorTheme?: string
    }) => { shell?: string; colorTheme?: string }
    expect(updater({ shell: 'zsh', colorTheme: 'follow' })).toEqual({
      shell: 'zsh',
      colorTheme: 'dracula',
    })
  })
})
