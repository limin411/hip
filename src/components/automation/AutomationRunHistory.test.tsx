// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Automation, AutomationRun } from '@/domain/automations'

const selectSession = vi.fn()

vi.mock('@/domain', () => ({
  sessionService: {
    selectSession: (...args: unknown[]) => selectSession(...args),
  },
}))

let storeRuns: AutomationRun[] = []

vi.mock('@/store/automationStore', () => {
  const useAutomationStore = (sel: (s: { runs: AutomationRun[] }) => unknown) =>
    sel({ runs: storeRuns })
  return { useAutomationStore }
})

import { AutomationRunHistory } from './AutomationRunHistory'

const baseAuto: Automation = {
  id: 'auto_1',
  name: 'Daily notes',
  prompt: 'Write notes',
  enabled: true,
  trigger: { kind: 'daily', hour: 9, minute: 0 },
  createdAt: 1,
  updatedAt: 1,
}

function mkRun(partial: Partial<AutomationRun> & Pick<AutomationRun, 'id' | 'status'>): AutomationRun {
  return {
    automationId: 'auto_1',
    trigger: 'manual',
    startedAt: 1_700_000_000_000,
    ...partial,
  }
}

describe('AutomationRunHistory', () => {
  beforeEach(() => {
    selectSession.mockClear()
    storeRuns = []
  })

  afterEach(() => {
    cleanup()
  })

  it('shows empty state when no runs for automation', () => {
    storeRuns = [
      mkRun({
        id: 'arun_other',
        automationId: 'auto_other',
        status: 'succeeded',
        sessionId: 's_other',
      }),
    ]
    render(<AutomationRunHistory automation={baseAuto} />)
    expect(screen.getByTestId('automation-run-history')).toBeInTheDocument()
    expect(screen.getByTestId('automation-run-history-empty')).toBeInTheDocument()
    expect(screen.getByTestId('automation-run-history-name')).toHaveTextContent(
      'Daily notes',
    )
  })

  it('lists status including waiting_user, skipped with reason, succeeded/failed', () => {
    storeRuns = [
      mkRun({
        id: 'arun_ok',
        status: 'succeeded',
        sessionId: 's1',
        startedAt: 100,
        finishedAt: 110,
      }),
      mkRun({
        id: 'arun_fail',
        status: 'failed',
        sessionId: 's2',
        error: 'session_error',
        startedAt: 90,
        finishedAt: 95,
      }),
      mkRun({
        id: 'arun_wait',
        status: 'waiting_user',
        sessionId: 's3',
        startedAt: 80,
      }),
      mkRun({
        id: 'arun_skip',
        status: 'skipped',
        error: 'missed_over_6h',
        trigger: 'schedule',
        startedAt: 70,
        finishedAt: 70,
      }),
    ]
    render(<AutomationRunHistory automation={baseAuto} />)

    expect(screen.getByTestId('automation-run-history-list')).toBeInTheDocument()
    expect(screen.getByTestId('automation-run-status-arun_ok')).toHaveTextContent(
      /succeeded/i,
    )
    expect(screen.getByTestId('automation-run-status-arun_fail')).toHaveTextContent(
      /failed/i,
    )
    expect(screen.getByTestId('automation-run-status-arun_wait')).toHaveTextContent(
      /waiting/i,
    )
    expect(screen.getByTestId('automation-run-status-arun_skip')).toHaveTextContent(
      /skipped/i,
    )
    expect(screen.getByTestId('automation-run-reason-arun_skip')).toBeInTheDocument()
    // Newest first
    const rows = screen.getAllByTestId(/^automation-run-row-/)
    expect(rows[0]).toHaveAttribute('data-testid', 'automation-run-row-arun_ok')
  })

  it('opens session via selectSession when run has sessionId', () => {
    storeRuns = [
      mkRun({
        id: 'arun_s',
        status: 'succeeded',
        sessionId: 'sess_abc',
        startedAt: 50,
      }),
      mkRun({
        id: 'arun_nosess',
        status: 'skipped',
        error: 'app_was_quit',
        trigger: 'catchup',
        startedAt: 40,
      }),
    ]
    render(<AutomationRunHistory automation={baseAuto} />)

    fireEvent.click(screen.getByTestId('automation-run-row-arun_s'))
    expect(selectSession).toHaveBeenCalledWith('sess_abc')

    selectSession.mockClear()
    fireEvent.click(screen.getByTestId('automation-run-row-arun_nosess'))
    expect(selectSession).not.toHaveBeenCalled()
  })

  it('calls onClose from close control', () => {
    const onClose = vi.fn()
    render(<AutomationRunHistory automation={baseAuto} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('automation-run-history-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
