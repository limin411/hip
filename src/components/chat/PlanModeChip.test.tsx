// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PlanModeChip } from './PlanModeChip'
import { useDraftStore } from '@/store/draftStore'
import { useDomainStore } from '@/domain'
import i18n from '@/i18n'

const setForcePlan = vi.fn()
const runPlanOn = vi.fn()
const runPlanOff = vi.fn()

vi.mock('@/domain', async () => {
  const actual = await vi.importActual<typeof import('@/domain')>('@/domain')
  return {
    ...actual,
    sessionService: {
      ...actual.sessionService,
      setForcePlan: (...args: unknown[]) => setForcePlan(...args),
    },
  }
})

vi.mock('@/domain/commands', async () => {
  const actual = await vi.importActual<typeof import('@/domain/commands')>('@/domain/commands')
  return {
    ...actual,
    runPlanOn: (...args: unknown[]) => runPlanOn(...args),
    runPlanOff: (...args: unknown[]) => runPlanOff(...args),
  }
})

describe('PlanModeChip', () => {
  beforeEach(async () => {
    cleanup()
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
    useDraftStore.setState({ draft: null })
    useDomainStore.setState({
      sessions: [],
      activeSessionId: null,
      connection: 'disconnected',
      hasApiKey: true,
      searchHits: [],
      searching: false,
      mcpStatuses: [],
      pluginInstall: null,
    })
  })

  it('toggles draft forcePlan via runPlanOn when no session', () => {
    useDraftStore.setState({
      draft: { tempId: 't1', mode: 'project', cwd: '/p', text: '', forcePlan: false },
    })
    render(<PlanModeChip />)
    const chip = screen.getByTestId('plan-mode-chip')
    expect(chip).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(chip)
    expect(runPlanOn).toHaveBeenCalledWith(null)
    expect(runPlanOff).not.toHaveBeenCalled()
  })

  it('turns draft forcePlan off via runPlanOff when already on', () => {
    useDraftStore.setState({
      draft: { tempId: 't1', mode: 'project', cwd: '/p', text: '', forcePlan: true },
    })
    render(<PlanModeChip />)
    const chip = screen.getByTestId('plan-mode-chip')
    expect(chip).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(chip)
    expect(runPlanOff).toHaveBeenCalledWith(null)
    expect(runPlanOn).not.toHaveBeenCalled()
  })

  it('toggles session forcePlan with session id', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: {
            llmProvider: 'deepseek',
            model: 'm',
            tools: [],
            surface: 'code',
            forcePlan: false,
          },
          title: 't',
          preview: '',
          updatedAtMs: 0,
          loaded: true,
          messages: [],
          status: 'idle',
          error: null,
          interrupt: null,
        },
      ],
      activeSessionId: 's1',
    } as never)

    render(<PlanModeChip />)
    fireEvent.click(screen.getByTestId('plan-mode-chip'))
    expect(runPlanOn).toHaveBeenCalledWith('s1')
  })

  it('is disabled while a turn is running', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: {
            llmProvider: 'deepseek',
            model: 'm',
            tools: [],
            surface: 'code',
            forcePlan: false,
          },
          title: 't',
          preview: '',
          updatedAtMs: 0,
          loaded: true,
          messages: [],
          status: 'running',
          error: null,
          interrupt: null,
        },
      ],
      activeSessionId: 's1',
    } as never)

    render(<PlanModeChip />)
    const chip = screen.getByTestId('plan-mode-chip')
    expect(chip).toBeDisabled()
    fireEvent.click(chip)
    expect(runPlanOn).not.toHaveBeenCalled()
    expect(runPlanOff).not.toHaveBeenCalled()
  })
})
