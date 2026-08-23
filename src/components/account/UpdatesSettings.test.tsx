// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { UpdatesSettings } from './UpdatesSettings'
import { useUpdatesStore } from '@/store/updatesStore'

const updateSection = vi.fn().mockResolvedValue(undefined)

const hipConfigState = {
  config: {
    version: 1 as const,
    updates: { autoCheck: false },
  },
  updateSection,
}

vi.mock('@/store/hipConfigStore', () => ({
  useHipConfigStore: (sel: (s: typeof hipConfigState) => unknown) => sel(hipConfigState),
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

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

describe('UpdatesSettings', () => {
  beforeEach(() => {
    useUpdatesStore.setState({ appInfo: null, lastResult: null, progress: null, checking: false })
    updatesIpc.fetchAppInfo.mockReset().mockResolvedValue(APP_INFO)
    updatesIpc.runCheck.mockReset().mockResolvedValue(checkResult())
    updatesIpc.startDownload.mockReset()
    updatesIpc.cancelDownload.mockReset()
    updatesIpc.openInstaller.mockReset()
    updatesIpc.openReleasePage.mockReset()
    updateSection.mockClear()
    hipConfigState.config.updates = { autoCheck: false }
  })
  afterEach(() => {
    cleanup()
  })

  it('mount hydration: app_info + force=false check, then writes the store', async () => {
    render(<UpdatesSettings />)
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
    render(<UpdatesSettings />)
    expect(screen.getByTestId('settings-updates-status')).toHaveTextContent(
      'settings.updates.idle',
    )
  })

  it('manual check invokes force=true and shows up-to-date', async () => {
    render(<UpdatesSettings />)
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
          browserDownloadUrl:
            'https://github.com/limin411/hip/releases/download/v1.0.2/hip_1.0.2_aarch64.dmg',
          sha256: 'aaaa'.repeat(16),
        },
      }),
    )
    render(<UpdatesSettings />)
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
          browserDownloadUrl:
            'https://github.com/limin411/hip/releases/download/v1.0.2/hip_1.0.2_aarch64.dmg',
        },
      }),
    )
    render(<UpdatesSettings />)
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
    render(<UpdatesSettings />)
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
    render(<UpdatesSettings />)
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
    render(<UpdatesSettings />)
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
    render(<UpdatesSettings />)
    expect(screen.getByTestId('settings-updates-status')).toHaveTextContent(
      'settings.updates.errorHash',
    )
  })

  it('auto toggle persists via functional merge preserving other fields, then checks once', async () => {
    render(<UpdatesSettings />)
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
    render(<UpdatesSettings />)
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
