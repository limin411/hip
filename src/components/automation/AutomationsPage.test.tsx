// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Automation, AutomationRun } from '@/domain/automations'

const load = vi.fn().mockResolvedValue(undefined)
const setEnabled = vi.fn().mockResolvedValue(undefined)
const remove = vi.fn().mockResolvedValue(undefined)
const runNow = vi.fn().mockResolvedValue(undefined)
const create = vi.fn().mockResolvedValue('auto_1')
const update = vi.fn().mockResolvedValue(undefined)
const select = vi.fn((id: string | null) => {
  storeState.selectedId = id
})
const clearPendingCreate = vi.fn(() => {
  storeState.pendingCreate = false
})

let storeState: {
  loaded: boolean
  loading: boolean
  error: string | null
  automations: Automation[]
  runs: AutomationRun[]
  selectedId: string | null
  pendingCreate: boolean
}

const selectSession = vi.fn()

vi.mock('@/store/automationStore', () => {
  const useAutomationStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      ...storeState,
      load,
      setEnabled,
      remove,
      runNow,
      create,
      update,
      select,
      clearPendingCreate,
    })
  useAutomationStore.getState = () => ({
    ...storeState,
    load,
    setEnabled,
    remove,
    runNow,
    create,
    update,
    select,
    clearPendingCreate,
  })
  return {
    useAutomationStore,
    isInFlight: () => false,
    subscribeInFlight: () => () => {},
    getInFlightVersion: () => 0,
    listInFlightIds: () => [],
  }
})

vi.mock('@/domain', () => ({
  sessionService: {
    selectSession: (...args: unknown[]) => selectSession(...args),
  },
}))

vi.mock('@/store/skillsStore', () => {
  const state = { skills: [], enabled: {}, loaded: true, load: vi.fn() }
  const useSkillsStore = (sel: (s: typeof state) => unknown) => sel(state)
  useSkillsStore.getState = () => state
  return { useSkillsStore }
})

vi.mock('@/store/hipConfigStore', () => {
  const state = {
    config: {
      window: { closeAction: 'quit', trayEnabled: false },
      agents: [] as { id: string; name: string; kind: string; enabled: boolean }[],
    },
    loaded: true,
    load: vi.fn(),
  }
  const useHipConfigStore = (sel: (s: typeof state) => unknown) => sel(state)
  useHipConfigStore.getState = () => state
  return {
    useHipConfigStore,
    useAgents: () => state.config.agents,
  }
})

vi.mock('@/store/providersStore', () => {
  const state = {
    catalog: {},
    config: { providers: {} },
    keyConfigured: {},
    loaded: true,
  }
  const useProvidersStore = (sel: (s: typeof state) => unknown) => sel(state)
  useProvidersStore.getState = () => state
  return { useProvidersStore }
})

vi.mock('@/ipc/dialog', () => ({
  pickDirectory: vi.fn().mockResolvedValue(null),
}))

/** Radix portal menus are flaky in happy-dom; render items inline for tests. */
vi.mock('@/components/ui/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-dropdown">{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({
    children,
    ...props
  }: {
    children: React.ReactNode
    'data-testid'?: string
  }) => (
    <div role="menu" {...props}>
      {children}
    </div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    ...props
  }: {
    children: React.ReactNode
    onSelect?: () => void
    'data-testid'?: string
    className?: string
    disabled?: boolean
  }) => (
    <button type="button" {...props} onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

import { AutomationsPage } from './AutomationsPage'

const sampleAutomation: Automation = {
  id: 'auto_test1',
  name: 'Daily notes',
  prompt: 'Write notes',
  enabled: true,
  trigger: { kind: 'daily', hour: 9, minute: 0 },
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: Date.now() + 60_000,
}

describe('AutomationsPage', () => {
  beforeEach(() => {
    load.mockClear()
    setEnabled.mockClear()
    remove.mockClear()
    runNow.mockClear()
    select.mockClear()
    clearPendingCreate.mockClear()
    selectSession.mockClear()
    storeState = {
      loaded: true,
      loading: false,
      error: null,
      automations: [],
      selectedId: null,
      pendingCreate: false,
      runs: [],
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('renders page root with empty gallery when no automations', () => {
    render(<AutomationsPage />)
    expect(screen.getByTestId('automations-page')).toBeInTheDocument()
    expect(screen.getByTestId('automations-page-header')).toBeInTheDocument()
    expect(screen.getByTestId('automation-empty-state')).toBeInTheDocument()
    expect(screen.getByTestId('automation-template-grid')).toBeInTheDocument()
  })

  it('renders list when automations exist', () => {
    storeState.automations = [sampleAutomation]
    render(<AutomationsPage />)
    expect(screen.getByTestId('automation-list')).toBeInTheDocument()
    expect(screen.getByTestId('automation-row-auto_test1')).toBeInTheDocument()
    expect(screen.queryByTestId('automation-empty-state')).not.toBeInTheDocument()
    // hipConfig mock: close=quit + tray off → schedule banner for daily enabled
    expect(screen.getByTestId('automation-schedule-banner')).toBeInTheDocument()
    expect(screen.getByTestId('automations-page-stats')).toBeInTheDocument()
  })

  it('shows loading empty while catalog loads', () => {
    storeState.loaded = false
    storeState.loading = true
    render(<AutomationsPage />)
    expect(screen.getByTestId('automations-page')).toBeInTheDocument()
  })

  it('keeps hook order stable when entering the loading early return', () => {
    // Mirrors real store: first paint often loaded=false/loading=false (full tree),
    // then load() sets loading=true (early return). Hooks must not drop.
    storeState.loaded = false
    storeState.loading = false
    const { rerender } = render(<AutomationsPage />)
    storeState.loading = true
    expect(() => rerender(<AutomationsPage />)).not.toThrow()
    expect(screen.getByTestId('automations-page')).toBeInTheDocument()
  })

  it('selecting a row opens detail panel with run history; session deep-link works', () => {
    storeState.automations = [
      {
        ...sampleAutomation,
        lastStatus: 'succeeded',
      },
    ]
    storeState.runs = [
      {
        id: 'arun_1',
        automationId: 'auto_test1',
        status: 'succeeded',
        trigger: 'manual',
        sessionId: 'sess_deep',
        startedAt: 100,
        finishedAt: 110,
      },
    ]
    const { rerender } = render(<AutomationsPage />)
    expect(screen.queryByTestId('automation-detail-panel')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('automation-row-auto_test1'))
    expect(select).toHaveBeenCalledWith('auto_test1')
    // Mock store does not subscribe; re-render with selectedId applied by select mock.
    rerender(<AutomationsPage />)
    expect(screen.getByTestId('automation-detail-panel')).toBeInTheDocument()
    expect(screen.getByTestId('automation-run-history')).toBeInTheDocument()
    expect(screen.getByTestId('automation-run-row-arun_1')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('automation-run-row-arun_1'))
    expect(selectSession).toHaveBeenCalledWith('sess_deep')

    fireEvent.click(screen.getByTestId('automation-detail-close'))
    expect(select).toHaveBeenCalledWith(null)
    rerender(<AutomationsPage />)
    expect(screen.queryByTestId('automation-detail-panel')).not.toBeInTheDocument()
  })

  it('row action controls do not toggle run history selection; Run stays on page by default', () => {
    storeState.automations = [sampleAutomation]
    const { rerender } = render(<AutomationsPage />)

    // Closed → Run does not open history; default focus false
    fireEvent.click(screen.getByTestId('automation-run-btn'))
    expect(runNow).toHaveBeenCalledWith('auto_test1', {
      focus: false,
      trigger: 'manual',
    })
    expect(screen.queryByTestId('automation-detail-panel')).not.toBeInTheDocument()

    // Open history via row select
    fireEvent.click(screen.getByTestId('automation-row-auto_test1'))
    expect(select).toHaveBeenCalledWith('auto_test1')
    rerender(<AutomationsPage />)
    expect(screen.getByTestId('automation-detail-panel')).toBeInTheDocument()
    expect(screen.getByTestId('automation-row-auto_test1')).toHaveAttribute(
      'data-selected',
      'true',
    )

    // Nested actions keep selection / panel open
    fireEvent.click(screen.getByTestId('automation-run-btn'))
    expect(screen.getByTestId('automation-detail-panel')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('automation-enable-auto_test1'))
    expect(screen.getByTestId('automation-detail-panel')).toBeInTheDocument()
    expect(setEnabled).toHaveBeenCalled()
  })

  it('delete opens confirm dialog instead of window.confirm', () => {
    storeState.automations = [sampleAutomation]
    render(<AutomationsPage />)

    fireEvent.click(screen.getByTestId('automation-delete-auto_test1'))
    expect(screen.getByTestId('automation-delete-confirm')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('automation-delete-confirm'))
    expect(remove).toHaveBeenCalledWith('auto_test1')
  })

  it('opens create editor when pendingCreate is set', () => {
    storeState.pendingCreate = true
    render(<AutomationsPage />)
    expect(clearPendingCreate).toHaveBeenCalled()
    expect(screen.getByTestId('automation-editor-modal')).toBeInTheDocument()
  })
})
