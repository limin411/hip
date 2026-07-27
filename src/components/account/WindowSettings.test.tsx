// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { WindowCloseAction } from '@hip/protocol'
import { WindowSettings } from './WindowSettings'

const updateSection = vi.fn().mockResolvedValue(undefined)
const load = vi.fn().mockResolvedValue(undefined)

const hipConfigState = {
  config: {
    version: 1 as const,
    window: { closeAction: 'quit' as WindowCloseAction, trayEnabled: false },
  },
  loaded: true,
  load,
  updateSection,
}

const setWindowPolicy = vi.fn().mockResolvedValue(null)
const setLaunchAtLogin = vi.fn().mockResolvedValue(undefined)

vi.mock('@/ipc/windowPolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ipc/windowPolicy')>()
  return {
    ...actual,
    setWindowPolicy: (...args: unknown[]) => setWindowPolicy(...args),
    setLaunchAtLogin: (...args: unknown[]) => setLaunchAtLogin(...args),
  }
})

vi.mock('@/store/hipConfigStore', () => ({
  useHipConfigStore: (sel: (s: typeof hipConfigState) => unknown) => sel(hipConfigState),
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

describe('WindowSettings', () => {
  beforeEach(() => {
    updateSection.mockClear()
    setWindowPolicy.mockClear()
    load.mockClear()
    hipConfigState.config.window = { closeAction: 'quit', trayEnabled: false }
  })
  afterEach(() => {
    cleanup()
  })

  it('renders close action and tray controls on standalone page', () => {
    render(<WindowSettings />)
    expect(screen.getByTestId('settings-page-window')).toBeInTheDocument()
    expect(screen.getByTestId('settings-close-action')).toBeInTheDocument()
    expect(screen.getByTestId('settings-tray-enabled')).toBeInTheDocument()
    expect(screen.getByTestId('settings-close-action-trigger')).toHaveTextContent(
      'settings.closeActions.quit',
    )
  })

  it('selecting hide enables tray and pushes shell policy', async () => {
    render(<WindowSettings />)
    fireEvent.click(screen.getByTestId('settings-close-action-hide'))
    await waitFor(() => {
      expect(updateSection).toHaveBeenCalledWith('window', expect.any(Function))
    })
    const updater = updateSection.mock.calls[0][1] as (prev: {
      closeAction?: string
      trayEnabled?: boolean
      closePromptSeen?: boolean
    }) => {
      closeAction?: string
      trayEnabled?: boolean
      closePromptSeen?: boolean
    }
    expect(updater({ closeAction: 'quit', trayEnabled: false })).toEqual({
      closeAction: 'hide',
      trayEnabled: true,
      closePromptSeen: true,
    })
    await waitFor(() => {
      expect(setWindowPolicy).toHaveBeenCalledWith('hide', true, true)
    })
  })

  it('exposes ask close action', () => {
    render(<WindowSettings />)
    expect(screen.getByTestId('settings-close-action-ask')).toBeInTheDocument()
  })

  it('enabling tray switch sets close action to hide and persists policy', async () => {
    render(<WindowSettings />)
    fireEvent.click(screen.getByTestId('settings-tray-enabled-switch'))
    await waitFor(() => {
      expect(updateSection).toHaveBeenCalledWith('window', expect.any(Function))
    })
    const updater = updateSection.mock.calls[0][1] as (prev: {
      closeAction?: string
      trayEnabled?: boolean
      closePromptSeen?: boolean
    }) => {
      closeAction?: string
      trayEnabled?: boolean
      closePromptSeen?: boolean
    }
    expect(updater({ closeAction: 'quit', trayEnabled: false })).toEqual({
      closeAction: 'hide',
      trayEnabled: true,
      closePromptSeen: true,
    })
    await waitFor(() => {
      expect(setWindowPolicy).toHaveBeenCalledWith('hide', true, true)
    })
  })

  it('enabling tray keeps ask close action', async () => {
    hipConfigState.config.window = { closeAction: 'ask', trayEnabled: false }
    render(<WindowSettings />)
    fireEvent.click(screen.getByTestId('settings-tray-enabled-switch'))
    await waitFor(() => {
      expect(updateSection).toHaveBeenCalledWith('window', expect.any(Function))
    })
    const updater = updateSection.mock.calls[0][1] as (prev: {
      closeAction?: string
      trayEnabled?: boolean
      closePromptSeen?: boolean
    }) => {
      closeAction?: string
      trayEnabled?: boolean
      closePromptSeen?: boolean
    }
    expect(updater({ closeAction: 'ask', trayEnabled: false })).toEqual({
      closeAction: 'ask',
      trayEnabled: true,
      closePromptSeen: true,
    })
  })

  it('disabling tray forces quit when close was hide', async () => {
    hipConfigState.config.window = { closeAction: 'hide', trayEnabled: true }
    render(<WindowSettings />)
    fireEvent.click(screen.getByTestId('settings-tray-enabled-switch'))
    await waitFor(() => {
      expect(updateSection).toHaveBeenCalledWith('window', expect.any(Function))
    })
    const updater = updateSection.mock.calls[0][1] as (prev: {
      closeAction?: string
      trayEnabled?: boolean
      closePromptSeen?: boolean
    }) => {
      closeAction?: string
      trayEnabled?: boolean
      closePromptSeen?: boolean
    }
    expect(updater({ closeAction: 'hide', trayEnabled: true })).toEqual({
      closeAction: 'quit',
      trayEnabled: false,
      closePromptSeen: true,
    })
  })
})
