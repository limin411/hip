// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/i18n'
import i18n from '@/i18n'
import type { Automation } from '@/domain/automations'

const SESSION_A = 'sess-a'
const SESSION_B = 'sess-b'

let activeId: string | null = SESSION_A
// Mirrors SessionVM: `config` is required, only `cwd` is optional.
let activeSession: {
  id: string
  title: string
  config: { cwd?: string }
} | null = {
  id: SESSION_A,
  title: 'Weekly digest',
  config: {},
}

vi.mock('@/domain', () => ({
  useActiveSessionId: () => activeId,
  useActiveSession: () => activeSession,
}))

const create = vi.fn<(input: Record<string, unknown>) => Promise<string>>()
const update = vi.fn<(id: string, patch: Record<string, unknown>) => Promise<void>>()
const remove = vi.fn<(id: string) => Promise<void>>()

let automations: Automation[] = []

vi.mock('@/store/automationStore', () => {
  const useAutomationStore = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ automations })
  useAutomationStore.getState = () => ({ automations, create, update, remove })
  return { useAutomationStore }
})

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock('sonner', () => ({ toast }))

import { ScheduledTaskBanner } from './ScheduledTaskBanner'
import { ScheduledTaskButton } from './ScheduledTaskButton'
import { ScheduledTaskPopover } from './ScheduledTaskPopover'
import { useScheduledTask, type ScheduledTaskDraft } from './useScheduledTask'

// ─── fixtures ───────────────────────────────────────────────

function auto(partial: Partial<Automation> & { id: string }): Automation {
  return {
    name: 'Job',
    prompt: 'do it',
    enabled: true,
    trigger: { kind: 'manual' },
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

/** Renders the hook into a probe component and exposes its return value. */
function renderHook() {
  const seen: { current: ReturnType<typeof useScheduledTask> | null } = { current: null }
  function Probe() {
    seen.current = useScheduledTask()
    return <div data-testid="probe">{seen.current.taskInfo ? 'has-task' : 'no-task'}</div>
  }
  const view = render(<Probe />)
  return { ...view, result: seen }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  localStorage.clear()
  automations = []
  activeId = SESSION_A
  activeSession = { id: SESSION_A, title: 'Weekly digest', config: {} }
  create.mockReset().mockResolvedValue('auto-new')
  update.mockReset().mockResolvedValue(undefined)
  remove.mockReset().mockResolvedValue(undefined)
  toast.success.mockClear()
  toast.error.mockClear()
  toast.info.mockClear()
})

afterEach(() => {
  cleanup()
})

// ─── useScheduledTask ───────────────────────────────────────

describe('useScheduledTask — task lookup', () => {
  it('returns no task when the catalog is empty', () => {
    const { result } = renderHook()
    expect(result.current?.taskInfo).toBeUndefined()
    expect(result.current?.scheduledTask).toBeUndefined()
  })

  it('ignores automations belonging to another conversation', () => {
    automations = [
      auto({
        id: 'auto_b',
        sessionId: SESSION_B,
        trigger: { kind: 'daily', hour: 9, minute: 0 },
      }),
    ]
    const { result } = renderHook()
    // Regression: the lookup used to be `find(a => a.enabled)`, so session B's
    // task leaked into session A's composer (and could be edited/deleted there).
    expect(result.current?.taskInfo).toBeUndefined()
  })

  it('ignores automations with no owning conversation', () => {
    automations = [auto({ id: 'auto_page', trigger: { kind: 'daily', hour: 9, minute: 0 } })]
    const { result } = renderHook()
    expect(result.current?.taskInfo).toBeUndefined()
  })

  it('ignores disabled tasks of the active conversation', () => {
    automations = [
      auto({ id: 'auto_off', sessionId: SESSION_A, enabled: false, trigger: { kind: 'daily', hour: 9, minute: 0 } }),
    ]
    const { result } = renderHook()
    expect(result.current?.taskInfo).toBeUndefined()
  })

  it('returns the task owned by the active conversation', () => {
    automations = [
      auto({ id: 'auto_b', sessionId: SESSION_B, trigger: { kind: 'daily', hour: 9, minute: 0 } }),
      auto({ id: 'auto_a', sessionId: SESSION_A, trigger: { kind: 'daily', hour: 9, minute: 30 }, prompt: 'summarize' }),
    ]
    const { result } = renderHook()
    expect(result.current?.taskInfo?.id).toBe('auto_a')
    expect(result.current?.taskInfo?.hour).toBe(9)
    expect(result.current?.taskInfo?.minute).toBe(30)
    expect(result.current?.taskInfo?.prompt).toBe('summarize')
  })

  it('maps interval / weekly triggers onto taskInfo', () => {
    automations = [
      auto({ id: 'auto_i', sessionId: SESSION_A, trigger: { kind: 'interval', intervalMinutes: 45 } }),
    ]
    const { result } = renderHook()
    expect(result.current?.taskInfo?.frequency).toBe('interval')
    expect(result.current?.taskInfo?.intervalMinutes).toBe(45)
    expect(result.current?.taskInfo?.weekday).toBeUndefined()

    cleanup()
    automations = [
      auto({ id: 'auto_w', sessionId: SESSION_A, trigger: { kind: 'weekly', weekday: 1, hour: 8, minute: 15 } }),
    ]
    const second = renderHook()
    expect(second.result.current?.taskInfo?.frequency).toBe('weekly')
    expect(second.result.current?.taskInfo?.weekday).toBe(1)
  })

  it('returns no task for a manual trigger instead of crashing', () => {
    automations = [auto({ id: 'auto_m', sessionId: SESSION_A, trigger: { kind: 'manual' } })]
    const { result } = renderHook()
    expect(result.current?.taskInfo).toBeUndefined()
  })

  it('returns no task when there is no active session', () => {
    activeId = null
    activeSession = null
    automations = [auto({ id: 'auto_a', sessionId: SESSION_A, trigger: { kind: 'daily', hour: 9, minute: 0 } })]
    const { result } = renderHook()
    expect(result.current?.taskInfo).toBeUndefined()
  })
})

describe('useScheduledTask — formatting', () => {
  it('formats interval frequency in minutes and hours', () => {
    const { result } = renderHook()
    expect(result.current?.getFrequencyText('interval', 30)).toBe('Every 30 minutes')
    expect(result.current?.getFrequencyText('interval', 120)).toBe('Every 2 hours')
    // 0 / undefined must fall back to the default interval, not "Every 0 minutes".
    expect(result.current?.getFrequencyText('interval', 0)).toBe('Every 30 minutes')
  })

  it('formats daily and weekly frequency', () => {
    const { result } = renderHook()
    expect(result.current?.getFrequencyText('daily')).toBe('Daily')
    expect(result.current?.getFrequencyText('weekly', 30, 1)).toBe('Weekly Monday')
    expect(result.current?.getFrequencyText('weekly', 30, 0)).toBe('Weekly Sunday')
  })

  it('zero-pads the time text', () => {
    const { result } = renderHook()
    expect(result.current?.getTimeText(9, 5)).toBe('09:05')
    expect(result.current?.getTimeText(18, 30)).toBe('18:30')
  })
})

describe('useScheduledTask — next run', () => {
  it('prefers the catalog nextRunAt over recomputing', () => {
    const nextRunAt = new Date('2030-01-01T10:00:00Z').getTime()
    automations = [
      auto({
        id: 'auto_a',
        sessionId: SESSION_A,
        trigger: { kind: 'interval', intervalMinutes: 5 },
        nextRunAt,
      }),
    ]
    const { result } = renderHook()
    expect(result.current?.getNextRun(automations[0]!)?.getTime()).toBe(nextRunAt)
    expect(result.current?.taskInfo?.nextRun).toBe(new Date(nextRunAt).toLocaleString())
  })

  it('falls back to computing from the trigger when nextRunAt is missing', () => {
    automations = [
      auto({
        id: 'auto_a',
        sessionId: SESSION_A,
        trigger: { kind: 'interval', intervalMinutes: 5 },
        nextRunAt: null,
      }),
    ]
    const { result } = renderHook()
    const next = result.current?.getNextRun(automations[0]!)
    expect(next).toBeInstanceOf(Date)
    expect(next!.getTime()).toBeGreaterThan(Date.now())
  })

  it('returns undefined for manual triggers', () => {
    const { result } = renderHook()
    expect(result.current?.getNextRun(auto({ id: 'm', trigger: { kind: 'manual' } }))).toBeUndefined()
  })
})

describe('useScheduledTask — mutations', () => {
  const draft: ScheduledTaskDraft = {
    frequency: 'daily',
    intervalMinutes: 30,
    hour: 9,
    minute: 30,
    prompt: 'summarize the repo',
  }

  it('creates a task scoped to the active conversation with the typed prompt', async () => {
    const { result } = renderHook()
    result.current!.createScheduledTask(draft)

    expect(create).toHaveBeenCalledTimes(1)
    const input = create.mock.calls[0]![0]
    expect(input.sessionId).toBe(SESSION_A)
    expect(input.prompt).toBe('summarize the repo')
    expect(input.enabled).toBe(true)
    expect(input.trigger).toEqual({ kind: 'daily', hour: 9, minute: 30 })
    // Name is disambiguated by conversation title — the catalog rejects duplicates.
    expect(input.name).toContain('Weekly digest')

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it('creates an interval task with the default interval when minutes are missing', () => {
    const { result } = renderHook()
    result.current!.createScheduledTask({ ...draft, frequency: 'interval', intervalMinutes: 0 })
    expect(create.mock.calls[0]![0].trigger).toEqual({ kind: 'interval', intervalMinutes: 30 })
  })

  it('records the project path so a project task fires back into its project', () => {
    activeSession = {
      id: SESSION_A,
      title: 'Weekly digest',
      config: { cwd: '  /work/proj  ' },
    }
    const { result } = renderHook()
    result.current!.createScheduledTask(draft)

    // Regression: the owning conversation id was persisted without its project
    // path, and the fire's surface is derived from that path alone — so a task
    // configured in a project conversation produced its runs in Chats.
    expect(create.mock.calls[0]![0].projectPath).toBe('/work/proj')
  })

  it('records a null project path for a sandbox conversation', () => {
    const { result } = renderHook()
    result.current!.createScheduledTask(draft)
    expect(create.mock.calls[0]![0].projectPath).toBeNull()
  })

  it('does nothing without an active session', () => {
    activeId = null
    activeSession = null
    const { result } = renderHook()
    result.current!.createScheduledTask(draft)
    expect(create).not.toHaveBeenCalled()
  })

  it('surfaces a failed create instead of an unhandled rejection', async () => {
    create.mockRejectedValueOnce(new Error('name taken'))
    const { result } = renderHook()
    result.current!.createScheduledTask(draft)
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('updates the existing task and re-shows a dismissed banner', async () => {
    localStorage.setItem('scheduledTaskDismissed', JSON.stringify({ auto_a: true }))
    automations = [
      auto({ id: 'auto_a', sessionId: SESSION_A, trigger: { kind: 'daily', hour: 9, minute: 0 } }),
    ]
    const { result } = renderHook()
    expect(result.current?.taskInfo?.bannerDismissed).toBe(true)

    result.current!.updateScheduledTask(draft)

    expect(update).toHaveBeenCalledWith(
      'auto_a',
      expect.objectContaining({
        prompt: 'summarize the repo',
        trigger: { kind: 'daily', hour: 9, minute: 30 },
      }),
    )
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('scheduledTaskDismissed') || '{}')).toEqual({}),
    )
  })

  it('re-records the project path when an existing task is edited', () => {
    activeSession = {
      id: SESSION_A,
      title: 'Weekly digest',
      config: { cwd: '/work/proj' },
    }
    automations = [
      auto({ id: 'auto_a', sessionId: SESSION_A, trigger: { kind: 'daily', hour: 9, minute: 0 } }),
    ]
    const { result } = renderHook()
    result.current!.updateScheduledTask(draft)

    // Lets a row saved before the field existed heal on edit instead of staying
    // stuck firing into Chats forever.
    expect(update).toHaveBeenCalledWith(
      'auto_a',
      expect.objectContaining({ projectPath: '/work/proj' }),
    )
  })

  it('deletes the task and clears its dismissed state', async () => {
    localStorage.setItem('scheduledTaskDismissed', JSON.stringify({ auto_a: true }))
    automations = [
      auto({ id: 'auto_a', sessionId: SESSION_A, trigger: { kind: 'daily', hour: 9, minute: 0 } }),
    ]
    const { result } = renderHook()
    result.current!.deleteScheduledTask()
    expect(remove).toHaveBeenCalledWith('auto_a')
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('scheduledTaskDismissed') || '{}')).toEqual({}),
    )
  })
})

// ─── ScheduledTaskPopover ───────────────────────────────────

describe('ScheduledTaskPopover', () => {
  const baseProps = {
    onOpenChange: () => {},
    initialFrequency: 'interval' as const,
    initialIntervalMinutes: 30,
    initialHour: 9,
    initialMinute: 0,
    initialWeekday: 0,
    initialPrompt: '',
    hasExistingTask: false,
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
  }

  it('re-seeds its fields from props each time it opens', () => {
    const { rerender } = render(<ScheduledTaskPopover {...baseProps} open={false} />)
    rerender(
      <ScheduledTaskPopover
        {...baseProps}
        open
        initialFrequency="daily"
        initialHour={18}
        initialMinute={45}
        initialPrompt="nightly report"
      />,
    )
    // Regression: state was initialised once, so a saved schedule was overwritten
    // with the defaults from the first render.
    expect(screen.getByTestId('scheduled-task-frequency')).toHaveValue('daily')
    expect(screen.getByTestId('scheduled-task-hour')).toHaveValue('18')
    expect(screen.getByTestId('scheduled-task-minute')).toHaveValue('45')
    expect(screen.getByTestId('scheduled-task-prompt')).toHaveValue('nightly report')
  })

  it('blocks submit until the task prompt is filled in', () => {
    render(<ScheduledTaskPopover {...baseProps} open onCreate={baseProps.onCreate} />)
    expect(screen.getByTestId('scheduled-task-popover-submit')).toBeDisabled()
    fireEvent.change(screen.getByTestId('scheduled-task-prompt'), {
      target: { value: 'check the build' },
    })
    expect(screen.getByTestId('scheduled-task-popover-submit')).toBeEnabled()
  })

  it('ignores a whitespace-only prompt', () => {
    render(<ScheduledTaskPopover {...baseProps} open />)
    fireEvent.change(screen.getByTestId('scheduled-task-prompt'), { target: { value: '   ' } })
    expect(screen.getByTestId('scheduled-task-popover-submit')).toBeDisabled()
  })

  it('submits the edited draft on create', () => {
    const onCreate = vi.fn()
    render(<ScheduledTaskPopover {...baseProps} open onCreate={onCreate} />)
    fireEvent.change(screen.getByTestId('scheduled-task-frequency'), { target: { value: 'weekly' } })
    fireEvent.change(screen.getByTestId('scheduled-task-weekday'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('scheduled-task-prompt'), { target: { value: '  weekly scan  ' } })
    fireEvent.click(screen.getByTestId('scheduled-task-popover-submit'))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        frequency: 'weekly',
        weekday: 3,
        prompt: 'weekly scan',
      }),
    )
  })

  it('routes to onUpdate and shows delete when a task exists', () => {
    const onUpdate = vi.fn()
    const onDelete = vi.fn()
    render(
      <ScheduledTaskPopover
        {...baseProps}
        open
        hasExistingTask
        initialPrompt="existing"
        onUpdate={onUpdate}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByTestId('scheduled-task-popover-submit'))
    expect(onUpdate).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('scheduled-task-popover-delete'))
    expect(onDelete).toHaveBeenCalled()
  })

  it('shows the interval picker only for interval frequency', () => {
    render(<ScheduledTaskPopover {...baseProps} open />)
    expect(screen.getByTestId('scheduled-task-interval')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('scheduled-task-frequency'), { target: { value: 'daily' } })
    expect(screen.queryByTestId('scheduled-task-interval')).not.toBeInTheDocument()
    expect(screen.getByTestId('scheduled-task-hour')).toBeInTheDocument()
  })
})

// ─── ScheduledTaskBanner ────────────────────────────────────

describe('ScheduledTaskBanner', () => {
  it('renders nothing without a task', () => {
    const { container } = render(<ScheduledTaskBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the schedule, prompt and next run', () => {
    const nextRunAt = new Date('2030-01-01T10:00:00Z').getTime()
    automations = [
      auto({
        id: 'auto_a',
        sessionId: SESSION_A,
        trigger: { kind: 'daily', hour: 9, minute: 30 },
        prompt: 'summarize the repo',
        nextRunAt,
      }),
    ]
    render(<ScheduledTaskBanner />)
    expect(screen.getByTestId('scheduled-task-banner')).toHaveTextContent('Daily')
    expect(screen.getByTestId('scheduled-task-banner')).toHaveTextContent('09:30')
    expect(screen.getByTestId('scheduled-task-banner-prompt')).toHaveTextContent('summarize the repo')
    expect(screen.getByTestId('scheduled-task-banner')).toHaveTextContent('Next run:')
  })

  it('hides the banner on close and remembers it in localStorage', () => {
    automations = [
      auto({ id: 'auto_a', sessionId: SESSION_A, trigger: { kind: 'daily', hour: 9, minute: 0 } }),
    ]
    const { container } = render(<ScheduledTaskBanner />)
    expect(screen.getByTestId('scheduled-task-banner')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('scheduled-task-banner-close'))
    // Regression: `bannerDismissed` was computed but never honoured, so closing
    // the banner did nothing.
    expect(container.firstChild).toBeNull()
    expect(JSON.parse(localStorage.getItem('scheduledTaskDismissed') || '{}')).toEqual({
      auto_a: true,
    })
  })

  it('stays hidden for a dismissed task after remount', () => {
    localStorage.setItem('scheduledTaskDismissed', JSON.stringify({ auto_a: true }))
    automations = [
      auto({ id: 'auto_a', sessionId: SESSION_A, trigger: { kind: 'daily', hour: 9, minute: 0 } }),
    ]
    const { container } = render(<ScheduledTaskBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('still shows the banner for a different task id', () => {
    localStorage.setItem('scheduledTaskDismissed', JSON.stringify({ auto_old: true }))
    automations = [
      auto({ id: 'auto_a', sessionId: SESSION_A, trigger: { kind: 'daily', hour: 9, minute: 0 } }),
    ]
    render(<ScheduledTaskBanner />)
    expect(screen.getByTestId('scheduled-task-banner')).toBeInTheDocument()
  })

  it('calls onEdit when provided', () => {
    automations = [
      auto({ id: 'auto_a', sessionId: SESSION_A, trigger: { kind: 'daily', hour: 9, minute: 0 } }),
    ]
    const onEdit = vi.fn()
    render(<ScheduledTaskBanner onEdit={onEdit} />)
    fireEvent.click(screen.getByTestId('scheduled-task-banner-edit'))
    expect(onEdit).toHaveBeenCalled()
  })
})

// ─── ScheduledTaskButton ────────────────────────────────────

describe('ScheduledTaskButton', () => {
  it('renders as inactive with no task', () => {
    render(<ScheduledTaskButton />)
    const button = screen.getByTestId('scheduled-task-button')
    expect(button).toBeInTheDocument()
    expect(button.querySelector('svg')).toBeInTheDocument()
    expect(button).toHaveTextContent('')
  })

  it('marks the chip active once a task is configured', () => {
    // Regression: configuring a task left the chip looking identical to the
    // "no task" state, so there was no feedback that anything had been saved.
    render(<ScheduledTaskButton />)
    expect(screen.getByTestId('scheduled-task-button').className).not.toContain(
      'bg-state-active',
    )

    cleanup()
    automations = [
      auto({
        id: 'auto_a',
        sessionId: SESSION_A,
        trigger: { kind: 'interval', intervalMinutes: 30 },
      }),
    ]
    render(<ScheduledTaskButton />)
    const active = screen.getByTestId('scheduled-task-button')
    // Accent "configured" badge — the neutral active tint is too close to hover.
    expect(active.className).toContain('bg-accent/10')
    expect(active.className).toContain('text-accent')
    // cn() must have merged the chip's default tint away: if both classes
    // survive, which one paints is decided by stylesheet order, not class order.
    expect(active.className).not.toContain('bg-state-active')
    expect(active).toHaveTextContent('30m')
  })

  it('shows the interval label when a task exists', () => {
    automations = [
      auto({
        id: 'auto_a',
        sessionId: SESSION_A,
        trigger: { kind: 'interval', intervalMinutes: 120 },
      }),
    ]
    render(<ScheduledTaskButton />)
    expect(screen.getByTestId('scheduled-task-button')).toHaveTextContent('2h')
  })

  it('shows the time label for a daily task', () => {
    automations = [
      auto({ id: 'auto_a', sessionId: SESSION_A, trigger: { kind: 'daily', hour: 9, minute: 5 } }),
    ]
    render(<ScheduledTaskButton />)
    expect(screen.getByTestId('scheduled-task-button')).toHaveTextContent('09:05')
  })

  it('asks for a conversation instead of opening the popover', () => {
    activeId = null
    activeSession = null
    render(<ScheduledTaskButton />)
    fireEvent.click(screen.getByTestId('scheduled-task-button'))
    expect(toast.info).toHaveBeenCalled()
    expect(screen.queryByTestId('scheduled-task-prompt')).not.toBeInTheDocument()
  })

  it('creates a task through the popover', async () => {
    render(<ScheduledTaskButton />)
    fireEvent.click(screen.getByTestId('scheduled-task-button'))
    fireEvent.change(screen.getByTestId('scheduled-task-prompt'), {
      target: { value: 'check the build' },
    })
    fireEvent.click(screen.getByTestId('scheduled-task-popover-submit'))

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_A,
        prompt: 'check the build',
        trigger: { kind: 'interval', intervalMinutes: 30 },
      }),
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it('updates (not creates) when the conversation already has a task', () => {
    automations = [
      auto({
        id: 'auto_a',
        sessionId: SESSION_A,
        trigger: { kind: 'daily', hour: 9, minute: 0 },
        prompt: 'old',
      }),
    ]
    render(<ScheduledTaskButton />)
    fireEvent.click(screen.getByTestId('scheduled-task-button'))
    expect(screen.getByTestId('scheduled-task-prompt')).toHaveValue('old')
    fireEvent.change(screen.getByTestId('scheduled-task-prompt'), { target: { value: 'new' } })
    fireEvent.click(screen.getByTestId('scheduled-task-popover-submit'))
    expect(update).toHaveBeenCalledWith('auto_a', expect.objectContaining({ prompt: 'new' }))
    expect(create).not.toHaveBeenCalled()
  })
})
