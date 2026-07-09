// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { AgentManagement } from './AgentManagement'

// Mock @/ipc/hipConfig — setHipConfig rejects to trigger the catch path
const setHipConfig = vi.fn()
const getHipConfig = vi.fn()
vi.mock('@/ipc/hipConfig', () => ({
  getHipConfig: (...a: unknown[]) => getHipConfig(...a),
  setHipConfig: (...a: unknown[]) => setHipConfig(...a),
}))

// Mock sonner toast
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => toastError(...a) },
  Toaster: () => null,
}))

// Mock react-i18next — use importOriginal so i18n/index.ts can still initI18next
vi.mock(import('react-i18next'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string }) => {
        const map: Record<string, string> = {
          'settings.agents.title': 'Agent Management',
          'settings.agents.intro': 'Register external agents.',
          'settings.agents.sectionBuiltin': 'Built-in agents',
          'settings.agents.customSection': 'Custom agents',
          'settings.agents.overviewTotal': 'Total agents',
          'settings.agents.overviewEnabled': 'Enabled',
          'settings.agents.builtin': 'Built-in',
          'settings.agents.enableThis': 'Available as sub-agent',
          'settings.agents.searchPlaceholder': 'Search agents…',
          'settings.agents.gridEmptyTitle': 'No external agents yet',
          'settings.agents.gridEmptyHint': 'Add an internal or ACP agent to get started.',
          'settings.agents.toggleFailed': 'Failed to save agent setting',
          'settings.agents.addAgent': 'Add agent',
          'settings.agents.fixedCoderDesc': 'Default sub-agent.',
          'settings.agents.fixedExploreDesc': 'Read-only codebase explorer.',
          'settings.agents.fixedPlanDesc': 'Architecture planner.',
        }
        if (map[key]) return map[key]
        return options?.defaultValue ?? key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  } as any
})

// Mock @/store/agentsStore
vi.mock('@/store/agentsStore', () => ({
  useAgentsStore: vi.fn(() => ({
    agents: [],
    loaded: true,
    load: vi.fn(),
    addAgent: vi.fn(),
    updateAgent: vi.fn(),
    removeAgent: vi.fn(),
  })),
}))

// Mock @/store/detectionStore
const refreshDetection = vi.fn()
vi.mock('@/store/detectionStore', () => ({
  useDetectionStore: vi.fn((selector) =>
    selector({
      installed: {},
      checked: true,
      refresh: refreshDetection,
    }),
  ),
}))

beforeEach(async () => {
  vi.clearAllMocks()
  // Default: setHipConfig succeeds, getHipConfig returns seeded state
  setHipConfig.mockResolvedValue(undefined)
  getHipConfig.mockResolvedValue({
    version: 1,
    fixedAgents: { coder: true, explore: true, plan: true },
    agents: [],
  })
  // Seed the real hipConfigStore with initial state so fixedAgents is populated
  const { useHipConfigStore } = await import('@/store/hipConfigStore')
  useHipConfigStore.setState({
    config: {
      version: 1,
      fixedAgents: { coder: true, explore: true, plan: true },
      agents: [],
    },
    loaded: true,
    error: null,
  })
})

afterEach(() => {
  cleanup()
})

describe('AgentManagement — toggle failure handling', () => {
  it('reverts state and shows error toast when setHipConfig fails', async () => {
    // Make setHipConfig reject so updateSection's persist throws
    setHipConfig.mockRejectedValueOnce(new Error('persist failed'))

    render(<AgentManagement />)

    // Wait for the fixed agent cards to render
    await waitFor(() => {
      expect(screen.getByText('Coder')).toBeInTheDocument()
    })

    // All three switches should be checked initially (coder, explore, plan)
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(3)
    expect(switches[0]).toBeChecked()

    // Toggle the first fixed agent (Coder) off
    fireEvent.click(switches[0])

    // Toast should appear with the error key
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Failed to save agent setting')
    })

    // Zustand state should be reverted to previous value
    const { useHipConfigStore } = await import('@/store/hipConfigStore')
    const state = useHipConfigStore.getState()
    // fixedAgents still has { coder: true } (reverted from { coder: false, ... })
    expect(state.config.fixedAgents).toEqual({ coder: true, explore: true, plan: true })
  })
})

describe('AgentManagement — binary detection', () => {
  it('refreshes binary detection on mount', async () => {
    refreshDetection.mockResolvedValue(undefined)
    render(<AgentManagement />)
    await waitFor(() => {
      expect(refreshDetection).toHaveBeenCalledTimes(1)
    })
  })
})
