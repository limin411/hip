// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AppLayout } from './AppLayout'

/**
 * Regression guard for the "定时任务配好了但从不执行" bug.
 *
 * `AutomationRunHost` is the *only* thing that evaluates schedules and calls
 * `runNow`. It was gated on `AUTOMATION_PAGE` and got deleted together with the
 * automations page (953a67ff), which silently disabled every scheduled task —
 * including the composer ones, which live outside that page. AppLayout must
 * mount it unconditionally for the whole app lifetime.
 */
vi.mock('@/components/automation/AutomationRunHost', () => ({
  AutomationRunHost: () => <div data-testid="automation-run-host" />,
}))

// happy-dom has no layout, so real panels cannot measure and throw
// "Panel size not found" from an effect. Stub them with imperatives intact.
vi.mock('react-resizable-panels', async () => {
  const { createElement, forwardRef, useImperativeHandle } = await import('react')
  return {
    PanelGroup: ({ children }: { children?: ReactNode }) =>
      createElement('div', null, children),
    Panel: forwardRef<unknown, { children?: ReactNode }>(function Panel(
      { children },
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        isCollapsed: () => true,
        getSize: () => 0,
        expand: () => undefined,
        collapse: () => undefined,
      }))
      return createElement('div', null, children)
    }),
    PanelResizeHandle: () => null,
  }
})

// Everything below is shell chrome we do not care about here — stub it so the
// test stays about the host wiring only.
vi.mock('@/components/window/WindowLifecycleHost', () => ({
  WindowLifecycleHost: () => null,
}))
vi.mock('@/components/layout/AppSidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/layout/MainToolbar', () => ({ MainToolbar: () => null }))
vi.mock('@/components/layout/PlaceholderPage', () => ({
  PlaceholderPage: () => null,
}))
vi.mock('@/components/layout/OverlayShellHost', () => ({
  OverlayShellHost: () => null,
}))
vi.mock('@/components/layout/navHistory', () => ({
  seedNavHistoryIfEmpty: () => undefined,
}))
vi.mock('@/components/account/SettingsPage', () => ({ SettingsPage: () => null }))
vi.mock('@/components/command-palette', () => ({
  GlobalCommandPalette: () => null,
  GlobalHotkeysBinder: () => null,
}))
vi.mock('@/components/history/SessionMenuDialogHost', () => ({
  SessionMenuDialogHost: () => null,
}))
vi.mock('@/components/terminals/ManagedTerminalDialogHost', () => ({
  ManagedTerminalDialogHost: () => null,
}))
vi.mock('@/components/terminals/TerminalManagementPage', () => ({
  TerminalManagementPage: () => null,
}))
vi.mock('@/components/terminals/TerminalRightPanel', () => ({
  TerminalRightPanel: () => null,
}))
vi.mock('@/components/artifact/ArtifactPanel', () => ({ ArtifactPanel: () => null }))
vi.mock('@/components/artifact/PreviewPanel', () => ({ PreviewPanel: () => null }))
vi.mock('@/components/chat/NewConversation', () => ({ NewConversation: () => null }))
vi.mock('@/components/chat/ChatPane', () => ({ ChatPane: () => null }))
vi.mock('@/components/chat/ComposerPlanPanel', () => ({
  ComposerPlanPanel: () => null,
}))
vi.mock('@/components/chat/PermissionModal', () => ({ PermissionModal: () => null }))
vi.mock('@/components/chat/GoalStatusChip', () => ({ GoalStatusChip: () => null }))
vi.mock('@/components/chat/InputBar', () => ({ InputBar: () => null }))
vi.mock('@/components/chat/RuntimeTaskStrip', () => ({ RuntimeTaskStrip: () => null }))
vi.mock('@/components/chat/MissingProjectBanner', () => ({
  MissingProjectBanner: () => null,
}))
vi.mock('@/components/chat/AcpCapabilityCliffBanner', () => ({
  AcpCapabilityCliffBanner: () => null,
}))

vi.mock('@/domain', () => ({
  sessionService: { connect: () => undefined, disconnect: () => undefined },
  useActiveSession: () => undefined,
  useDomainStore: { getState: () => ({ sessions: [] }) },
}))

vi.mock('@/store/providersStore', () => ({
  useProvidersStore: { getState: () => ({ loaded: true, load: () => undefined }) },
}))
vi.mock('@/store/projectPathStore', () => ({
  useProjectPathStore: {
    getState: () => ({ ensureChecked: () => undefined, invalidate: () => undefined }),
  },
}))
vi.mock('@/ipc/pty', () => ({
  startTerminalBridge: () => Promise.resolve(() => undefined),
}))

describe('AppLayout scheduler wiring', () => {
  afterEach(cleanup)

  it('mounts AutomationRunHost for the whole app lifetime', () => {
    render(<AppLayout />)
    expect(screen.getByTestId('automation-run-host')).toBeInTheDocument()
  })
})
