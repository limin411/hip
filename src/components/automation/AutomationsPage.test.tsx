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

let storeState: {
  loaded: boolean
  loading: boolean
  error: string | null
  automations: Automation[]
  runs: AutomationRun[]
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
    })
  useAutomationStore.getState = () => ({
    ...storeState,
    load,
    setEnabled,
    remove,
    runNow,
    create,
    update,
  })
  return {
    useAutomationStore,
    isInFlight: () => false,
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
    selectSession.mockClear()
    storeState = {
      loaded: true,
      loading: false,
      error: null,
      automations: [],
      runs: [],
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('renders page root with empty gallery when no automations', () => {
    render(<AutomationsPage />)
    expect(screen.getByTestId('automations-page')).toBeInTheDocument()
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

  it('selecting a row opens run history panel; session deep-link works', () => {
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
    render(<AutomationsPage />)
    expect(screen.queryByTestId('automation-run-history')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('automation-row-auto_test1'))
    expect(screen.getByTestId('automation-run-history')).toBeInTheDocument()
    expect(screen.getByTestId('automation-run-row-arun_1')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('automation-run-row-arun_1'))
    expect(selectSession).toHaveBeenCalledWith('sess_deep')

    fireEvent.click(screen.getByTestId('automation-run-history-close'))
    expect(screen.queryByTestId('automation-run-history')).not.toBeInTheDocument()
  })

  it('row action controls do not toggle run history selection', () => {
    storeState.automations = [sampleAutomation]
    render(<AutomationsPage />)

    // Closed → Run does not open history
    fireEvent.click(screen.getByTestId('automation-run-btn'))
    expect(runNow).toHaveBeenCalledWith('auto_test1', {
      focus: true,
      trigger: 'manual',
    })
    expect(screen.queryByTestId('automation-run-history')).not.toBeInTheDocument()

    // Open history via row select
    fireEvent.click(screen.getByTestId('automation-row-auto_test1'))
    expect(screen.getByTestId('automation-run-history')).toBeInTheDocument()
    expect(screen.getByTestId('automation-row-auto_test1')).toHaveAttribute(
      'data-selected',
      'true',
    )

    // Nested actions keep selection / panel open
    fireEvent.click(screen.getByTestId('automation-run-btn'))
    expect(screen.getByTestId('automation-run-history')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('automation-enable-auto_test1'))
    expect(screen.getByTestId('automation-run-history')).toBeInTheDocument()
    expect(setEnabled).toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('automation-edit-auto_test1'))
    expect(screen.getByTestId('automation-run-history')).toBeInTheDocument()
  })
})
