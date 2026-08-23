// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { WindowLifecycleHost } from './WindowLifecycleHost'
import { useUpdatesStore } from '@/store/updatesStore'

// Captured event callbacks registered by the Host.
const mocks = vi.hoisted(() => ({
  listeners: {} as Record<string, (p: unknown) => void>,
  unlisten: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@/ipc/updates', () => ({
  listenUpdatesProgress: (cb: (p: unknown) => void) => {
    mocks.listeners.progress = cb
    return Promise.resolve(mocks.unlisten)
  },
  listenUpdatesAvailable: (cb: (r: unknown) => void) => {
    mocks.listeners.available = cb
    return Promise.resolve(mocks.unlisten)
  },
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))

vi.mock('@/ipc/windowPolicy', () => ({
  isMainWindowVisible: vi.fn().mockResolvedValue(true),
  listenClosePrompt: vi.fn().mockResolvedValue(() => {}),
  listenExitConfirm: vi.fn().mockResolvedValue(() => {}),
  listenOpenSettings: vi.fn().mockResolvedValue(() => {}),
  listenWindowHidden: vi.fn().mockResolvedValue(() => {}),
  setWindowPolicy: vi.fn().mockResolvedValue(null),
  traySetLabels: vi.fn(),
  traySetStatus: vi.fn(),
  windowCancelExit: vi.fn(),
  windowCloseDecision: vi.fn(),
  windowExitHideInstead: vi.fn(),
  windowForceQuit: vi.fn(),
}))

vi.mock('@/store/hipConfigStore', () => ({
  useHipConfigStore: (
    sel: (s: { config: { window: Record<string, unknown> }; updateSection: () => void }) => unknown,
  ) =>
    sel({
      config: { window: { closeAction: 'quit' } },
      updateSection: vi.fn(),
    }),
}))

vi.mock('@/domain', () => ({
  useDomainStore: {
    getState: () => ({ sessions: [] }),
    subscribe: () => () => {},
  },
}))

vi.mock('@/store/taskRuntimeStore', () => ({
  useTaskRuntimeStore: {
    getState: () => ({ tasks: [] }),
    subscribe: () => () => {},
  },
}))

vi.mock('@/store/knowledgeStore', () => ({
  syncActiveEditorToDraft: vi.fn(),
  useKnowledgeStore: {
    getState: () => ({ hasUnsavedChanges: () => false }),
  },
}))

vi.mock('@/lib/activeWork', () => ({
  countActiveWork: () => ({ total: 0, running: 0 }),
}))

vi.mock('@/components/layout/sidebarActions', () => ({
  openSettingsOverlay: vi.fn(),
}))

const uiState: { overlay: string | null; settingsPage: string } = {
  overlay: null,
  settingsPage: 'general',
}
vi.mock('@/store/uiStore', () => {
  const useUiStore = (sel: (s: typeof uiState) => unknown) => sel(uiState)
  useUiStore.getState = () => uiState
  return { useUiStore }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const AVAILABLE = {
  status: 'update_available',
  currentVersion: '1.0.1',
  latestTag: 'v1.0.2',
  cacheHit: false,
  checkedAt: '2026-08-23T12:00:00Z',
  latencyMs: 10,
  debugBuild: false,
}

describe('WindowLifecycleHost updates listeners', () => {
  beforeEach(() => {
    useUpdatesStore.setState({ appInfo: null, lastResult: null, progress: null, checking: false })
    mocks.toast.mockClear()
    uiState.overlay = null
    uiState.settingsPage = 'general'
    delete mocks.listeners.progress
    delete mocks.listeners.available
  })
  afterEach(() => cleanup())

  it('available event writes the store then toasts when settings are closed', async () => {
    render(<WindowLifecycleHost />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.listeners.available).toBeDefined()
    act(() => mocks.listeners.available(AVAILABLE))
    expect(useUpdatesStore.getState().lastResult?.latestTag).toBe('v1.0.2')
    expect(mocks.toast).toHaveBeenCalledWith(
      'settings.updates.toastTitle',
      expect.objectContaining({
        action: expect.objectContaining({ label: 'settings.updates.toastAction' }),
        cancel: expect.objectContaining({ label: 'settings.updates.toastSnooze' }),
      }),
    )
  })

  it('still writes the store but skips the toast when settings/general is open', async () => {
    uiState.overlay = 'settings'
    uiState.settingsPage = 'general'
    render(<WindowLifecycleHost />)
    await act(async () => {
      await Promise.resolve()
    })
    act(() => mocks.listeners.available(AVAILABLE))
    expect(useUpdatesStore.getState().lastResult?.latestTag).toBe('v1.0.2')
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('progress events land in the store process-wide', async () => {
    render(<WindowLifecycleHost />)
    await act(async () => {
      await Promise.resolve()
    })
    act(() =>
      mocks.listeners.progress({
        phase: 'downloading',
        downloaded: 100,
        total: 1000,
        assetName: 'hip_1.0.2_aarch64.dmg',
      }),
    )
    expect(useUpdatesStore.getState().progress?.assetName).toBe('hip_1.0.2_aarch64.dmg')
  })
})
