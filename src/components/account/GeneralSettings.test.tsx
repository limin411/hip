// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { GeneralSettings } from './GeneralSettings'
import { useUpdatesStore } from '@/store/updatesStore'

const updateSection = vi.fn().mockResolvedValue(undefined)
const load = vi.fn().mockResolvedValue(undefined)

const hipConfigState = {
  config: {
    version: 1 as const,
    terminal: {
      shell: 'default' as const,
      colorTheme: 'follow' as const,
      bell: 'visual' as const,
    },
    codeBlock: { colorTheme: 'follow' as const },
    knowledge: { docWidth: 'default' as const },
    window: { closeAction: 'quit' as const, trayEnabled: false },
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

// ── Updates IPC mocks (the real store is used and reset per test) ──
const updatesIpc = {
  fetchAppInfo: vi.fn(),
  runCheck: vi.fn(),
  cancelDownload: vi.fn(),
  startDownload: vi.fn(),
  openInstaller: vi.fn(),
  openReleasePage: vi.fn(),
}

vi.mock('@/ipc/updates', () => ({
  updatesAppInfo: (...a: unknown[]) => updatesIpc.fetchAppInfo(...a),
  updatesCheck: (...a: unknown[]) => updatesIpc.runCheck(...a),
  updatesCancelDownload: (...a: unknown[]) => updatesIpc.cancelDownload(...a),
  updatesDownload: (...a: unknown[]) => updatesIpc.startDownload(...a),
  updatesOpenInstaller: (...a: unknown[]) => updatesIpc.openInstaller(...a),
  updatesOpenReleasePage: (...a: unknown[]) => updatesIpc.openReleasePage(...a),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

describe('GeneralSettings terminal shell', () => {
  beforeEach(() => {
    updateSection.mockClear()
    load.mockClear()
    hipConfigState.config.terminal = { shell: 'default', colorTheme: 'follow', bell: 'visual' }
    hipConfigState.config.codeBlock = { colorTheme: 'follow' }
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

describe('GeneralSettings code block color', () => {
  beforeEach(() => {
    updateSection.mockClear()
    load.mockClear()
    hipConfigState.config.codeBlock = { colorTheme: 'follow' }
  })
  afterEach(() => {
    cleanup()
  })

  it('renders code block color control', () => {
    render(<GeneralSettings />)
    const row = screen.getByTestId('settings-code-block-color')
    expect(row).toBeInTheDocument()
    expect(within(row).getByTestId('settings-code-block-color-trigger')).toHaveTextContent(
      'settings.codeBlockColors.follow',
    )
  })

  it('persists colorTheme via functional merge', async () => {
    render(<GeneralSettings />)
    fireEvent.click(screen.getByTestId('settings-code-block-color-dark'))
    await waitFor(() => {
      expect(updateSection).toHaveBeenCalledWith('codeBlock', expect.any(Function))
    })
    const updater = updateSection.mock.calls[0][1] as (prev: {
      colorTheme?: string
    }) => { colorTheme?: string }
    expect(updater({ colorTheme: 'follow' })).toEqual({ colorTheme: 'dark' })
  })
})

describe('GeneralSettings terminal color', () => {
  beforeEach(() => {
    updateSection.mockClear()
    load.mockClear()
    hipConfigState.config.terminal = { shell: 'default', colorTheme: 'follow', bell: 'visual' }
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

describe('GeneralSettings document width', () => {
  beforeEach(() => {
    updateSection.mockClear()
    load.mockClear()
    hipConfigState.config.knowledge = { docWidth: 'default' }
  })
  afterEach(() => {
    cleanup()
  })

  it('renders document width control', () => {
    render(<GeneralSettings />)
    const row = screen.getByTestId('settings-doc-width')
    expect(row).toBeInTheDocument()
    expect(within(row).getByTestId('settings-doc-width-trigger')).toHaveTextContent(
      'settings.docWidths.default',
    )
  })

  it('persists docWidth via functional merge', async () => {
    render(<GeneralSettings />)
    fireEvent.click(screen.getByTestId('settings-doc-width-wide'))
    await waitFor(() => {
      expect(updateSection).toHaveBeenCalledWith('knowledge', expect.any(Function))
    })
    const updater = updateSection.mock.calls[0][1] as (prev: {
      docWidth?: string
    }) => { docWidth?: string }
    expect(updater({ docWidth: 'default' })).toEqual({ docWidth: 'wide' })
  })
})

describe('GeneralSettings terminal bell (P0.5)', () => {
  beforeEach(() => {
    updateSection.mockClear()
    load.mockClear()
    hipConfigState.config.terminal = { shell: 'default', colorTheme: 'follow', bell: 'visual' }
  })
  afterEach(() => {
    cleanup()
  })

  it('renders bell control with the configured value', () => {
    render(<GeneralSettings />)
    const row = screen.getByTestId('settings-terminal-bell')
    expect(row).toBeInTheDocument()
    expect(within(row).getByTestId('settings-terminal-bell-trigger')).toHaveTextContent(
      'settings.terminalBells.visual',
    )
  })

  it('persists bell via functional merge and preserves shell + colorTheme', async () => {
    render(<GeneralSettings />)
    fireEvent.click(screen.getByTestId('settings-terminal-bell-off'))
    await waitFor(() => {
      expect(updateSection).toHaveBeenCalledWith('terminal', expect.any(Function))
    })
    const updater = updateSection.mock.calls[0][1] as (prev: {
      shell?: string
      colorTheme?: string
      bell?: string
    }) => { shell?: string; colorTheme?: string; bell?: string }
    expect(updater({ shell: 'zsh', colorTheme: 'dracula', bell: 'visual' })).toEqual({
      shell: 'zsh',
      colorTheme: 'dracula',
      bell: 'off',
    })
  })
})

// ──────────────────────────────────────────────────────────────
// Version & updates block
// ──────────────────────────────────────────────────────────────
const APP_INFO = { version: '1.0.1', debugBuild: false, os: 'macos', arch: 'aarch64' }

function checkResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 'up_to_date',
    currentVersion: '1.0.1',
    cacheHit: false,
    checkedAt: '2026-08-23T12:00:00Z',
    latencyMs: 10,
    debugBuild: false,
    ...overrides,
  }
}

describe('GeneralSettings updates', () => {
  beforeEach(() => {
    useUpdatesStore.setState({ appInfo: null, lastResult: null, progress: null, checking: false })
    updatesIpc.fetchAppInfo.mockReset().mockResolvedValue(APP_INFO)
    updatesIpc.runCheck.mockReset().mockResolvedValue(checkResult())
    updatesIpc.startDownload.mockReset()
    updatesIpc.cancelDownload.mockReset()
    updatesIpc.openInstaller.mockReset()
    updatesIpc.openReleasePage.mockReset()
    updateSection.mockClear()
  })
  afterEach(() => {
    cleanup()
  })

  it('mount hydration: app_info + force=false check, then writes the store', async () => {
    render(<GeneralSettings />)
    await waitFor(() => {
      expect(updatesIpc.fetchAppInfo).toHaveBeenCalled()
      expect(updatesIpc.runCheck).toHaveBeenCalledWith(false)
    })
    await waitFor(() => {
      expect(screen.getByTestId('settings-updates-version')).toHaveTextContent('1.0.1')
    })
    expect(useUpdatesStore.getState().appInfo).toEqual(APP_INFO)
    expect(useUpdatesStore.getState().lastResult?.status).toBe('up_to_date')
  })

  it('shows idle before any check resolves', () => {
    updatesIpc.runCheck.mockReturnValue(new Promise(() => {}))
    render(<GeneralSettings />)
    expect(screen.getByTestId('settings-updates-status')).toHaveTextContent(
      'settings.updates.idle',
    )
  })

  it('manual check invokes force=true and shows up-to-date', async () => {
    render(<GeneralSettings />)
    await waitFor(() => expect(updatesIpc.runCheck).toHaveBeenCalledWith(false))
    fireEvent.click(screen.getByTestId('settings-updates-check'))
    await waitFor(() => expect(updatesIpc.runCheck).toHaveBeenCalledWith(true))
    await waitFor(() => {
      expect(screen.getByTestId('settings-updates-status')).toHaveTextContent(
        'settings.updates.upToDate',
      )
    })
  })

  it('update_available with sha256 shows the install CTA', async () => {
    updatesIpc.runCheck.mockResolvedValue(
      checkResult({
        status: 'update_available',
        latestTag: 'v1.0.2',
        latestVersion: '1.0.2',
        publishedAt: '2026-08-23T12:00:00Z',
        htmlUrl: 'https://github.com/limin411/hip/releases/tag/v1.0.2',
        asset: {
          name: 'hip_1.0.2_aarch64.dmg',
          size: 57_000_000,
          browserDownloadUrl: 'https://github.com/limin411/hip/releases/download/v1.0.2/hip_1.0.2_aarch64.dmg',
          sha256: 'aaaa'.repeat(16),
        },
      }),
    )
    render(<GeneralSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('settings-updates-status')).toHaveTextContent(
        'settings.updates.available',
      )
    })
    expect(screen.getByTestId('settings-updates-install')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-updates-open-release')).not.toBeInTheDocument()
  })

  it('update_available without sha256 disables install and offers open-release', async () => {
    updatesIpc.runCheck.mockResolvedValue(
      checkResult({
        status: 'update_available',
        latestTag: 'v1.0.2',
        htmlUrl: 'https://github.com/limin411/hip/releases/tag/v1.0.2',
        asset: {
          name: 'hip_1.0.2_aarch64.dmg',
          size: 57_000_000,
          browserDownloadUrl: 'https://github.com/limin411/hip/releases/download/v1.0.2/hip_1.0.2_aarch64.dmg',
        },
      }),
    )
    render(<GeneralSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('settings-updates-status')).toHaveTextContent(
        'settings.updates.available',
      )
    })
    expect(screen.queryByTestId('settings-updates-install')).not.toBeInTheDocument()
    expect(screen.getByTestId('settings-updates-open-release')).toBeInTheDocument()
    expect(screen.getByText('settings.updates.noHash')).toBeInTheDocument()
  })

  it('no_matching_asset shows the open-release CTA and no install', async () => {
    updatesIpc.runCheck.mockResolvedValue(
      checkResult({
        status: 'no_matching_asset',
        latestTag: 'v1.0.2',
        htmlUrl: 'https://github.com/limin411/hip/releases/tag/v1.0.2',
      }),
    )
    render(<GeneralSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('settings-updates-status')).toHaveTextContent(
        'settings.updates.noAsset',
      )
    })
    expect(screen.queryByTestId('settings-updates-install')).not.toBeInTheDocument()
    expect(screen.getByTestId('settings-updates-open-release')).toBeInTheDocument()
  })

  it('current_ahead status', async () => {
    updatesIpc.runCheck.mockResolvedValue(
      checkResult({ status: 'current_ahead', latestTag: 'v1.0.1' }),
    )
    render(<GeneralSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('settings-updates-status')).toHaveTextContent(
        'settings.updates.ahead',
      )
    })
  })

  it('dev session: install hidden even with sha256, dev-blocked note shown', async () => {
    updatesIpc.fetchAppInfo.mockResolvedValue({ ...APP_INFO, debugBuild: true })
    updatesIpc.runCheck.mockResolvedValue(
      checkResult({
        status: 'update_available',
        latestTag: 'v1.0.2',
        htmlUrl: 'https://github.com/limin411/hip/releases/tag/v1.0.2',
        asset: {
          name: 'hip_1.0.2_aarch64.dmg',
          size: 57_000_000,
          browserDownloadUrl: 'https://x/hip_1.0.2_aarch64.dmg',
          sha256: 'aaaa'.repeat(16),
        },
      }),
    )
    render(<GeneralSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('settings-updates-status')).toHaveTextContent(
        'settings.updates.available',
      )
    })
    expect(screen.queryByTestId('settings-updates-install')).not.toBeInTheDocument()
    expect(screen.getByTestId('settings-updates-open-release')).toBeInTheDocument()
    expect(screen.getByText('settings.updates.devBlocked')).toBeInTheDocument()
  })

  it('error_hash progress shows the integrity-failure line', async () => {
    updatesIpc.runCheck.mockReturnValue(new Promise(() => {}))
    useUpdatesStore.setState({
      progress: { phase: 'error', downloaded: 0, assetName: 'x.dmg', errorKind: 'hash' },
    })
    render(<GeneralSettings />)
    expect(screen.getByTestId('settings-updates-status')).toHaveTextContent(
      'settings.updates.errorHash',
    )
  })

  it('auto toggle persists via functional merge preserving other fields, then checks once', async () => {
    render(<GeneralSettings />)
    const toggle = screen.getByTestId('settings-updates-auto')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(updateSection).toHaveBeenCalledWith('updates', expect.any(Function))
    })
    const updater = updateSection.mock.calls.find(
      (c) => c[0] === 'updates',
    )![1] as (prev: { autoCheck?: boolean; other?: string }) => Record<string, unknown>
    expect(updater({ autoCheck: false, other: 'keep' })).toEqual({
      autoCheck: true,
      other: 'keep',
    })
    // ON ⇒ exactly one immediate force=false check through the command path.
    expect(updatesIpc.runCheck).toHaveBeenCalledWith(false)
  })

  it('confirm modal shows the unsigned warning before download', async () => {
    updatesIpc.runCheck.mockResolvedValue(
      checkResult({
        status: 'update_available',
        latestTag: 'v1.0.2',
        htmlUrl: 'https://github.com/limin411/hip/releases/tag/v1.0.2',
        asset: {
          name: 'hip_1.0.2_aarch64.dmg',
          size: 57_000_000,
          browserDownloadUrl: 'https://x/hip_1.0.2_aarch64.dmg',
          sha256: 'aaaa'.repeat(16),
        },
      }),
    )
    render(<GeneralSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('settings-updates-install')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('settings-updates-install'))
    expect(screen.getByText('settings.updates.unsignedTitle')).toBeInTheDocument()
    expect(screen.getByText('settings.updates.unsignedBody')).toBeInTheDocument()
    // Confirming starts the download with the cached tag + asset name.
    fireEvent.click(screen.getByTestId('settings-updates-confirm'))
    await waitFor(() => {
      expect(updatesIpc.startDownload).toHaveBeenCalledWith('v1.0.2', 'hip_1.0.2_aarch64.dmg')
    })
  })
})
