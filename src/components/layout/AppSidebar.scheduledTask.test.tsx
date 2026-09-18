// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AppSidebar } from './AppSidebar'
import type { Automation } from '@/domain/automations'
import type { SessionVM } from '@/domain'

/**
 * Sidebar must mark conversations that own an **enabled** scheduled task:
 * the task lives in the global automation catalog, so without a marker there is
 * no way to tell from the session list which conversations will run unattended.
 */

let mockSessions: SessionVM[] = []
let mockAutomations: Automation[] = []

const now = Date.now()

function session(id: string, title: string): SessionVM {
  return {
    id,
    config: { surface: 'chat' } as SessionVM['config'],
    title,
    preview: '',
    updatedAtMs: now,
    loaded: true,
    messages: [],
    status: 'idle',
    error: null,
  }
}

function automation(id: string, sessionId: string | null, enabled = true): Automation {
  return {
    id,
    name: `task-${id}`,
    prompt: 'do the thing',
    enabled,
    trigger: { kind: 'daily', hour: 9, minute: 0 },
    sessionId,
    createdAt: now,
    updatedAt: now,
  }
}

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/domain', () => ({
  sessionService: { selectSession: vi.fn(), deleteSession: vi.fn() },
  useSessions: () => mockSessions,
  useActiveSessionId: () => null,
}))

// Catalog is app-lifetime state owned by AutomationRunHost; the sidebar only
// reads it.
vi.mock('@/store/automationStore', () => ({
  useAutomationStore: (selector: (s: { automations: Automation[] }) => unknown) =>
    selector({ automations: mockAutomations }),
}))

vi.mock('./sidebarActions', () => ({
  selectSessionFromSidebar: vi.fn(),
  newConversationFromSidebar: vi.fn(),
  enterSection: vi.fn(),
  enterPlaceholderSection: vi.fn(),
  enterTerminalsSection: vi.fn(),
  openSettingsFromChrome: vi.fn(),
  toggleHistoryOverlay: vi.fn(),
  toggleTrashOverlay: vi.fn(),
}))

vi.mock('./SidebarAccountFooter', () => ({ SidebarAccountFooter: () => null }))
vi.mock('./SettingsSidebarContent', () => ({ SettingsSidebarContent: () => null }))
vi.mock('@/components/terminals/QuickConnectPopover', () => ({
  QuickConnectPopover: () => null,
}))

describe('AppSidebar scheduled-task marker', () => {
  beforeEach(() => {
    mockSessions = [session('s1', 'Has task'), session('s2', 'No task')]
    mockAutomations = [automation('a1', 's1')]
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('marks the session owning an enabled scheduled task', () => {
    render(<AppSidebar />)
    expect(screen.getByTestId('sidebar-session-scheduled-s1')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-session-scheduled-s2')).not.toBeInTheDocument()
  })

  it('does not mark a session whose task is disabled', () => {
    mockAutomations = [automation('a1', 's1', false)]
    render(<AppSidebar />)
    expect(screen.queryByTestId('sidebar-session-scheduled-s1')).not.toBeInTheDocument()
  })

  it('names the marker in the row aria-label', () => {
    render(<AppSidebar />)
    const row = screen.getByTestId('sidebar-session-s1')
    expect(row.getAttribute('aria-label')).toContain('sidebar.status.scheduled')
    expect(screen.getByTestId('sidebar-session-s2').getAttribute('aria-label')).not.toContain(
      'sidebar.status.scheduled',
    )
  })
})
