// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { RuntimeTaskStrip } from './RuntimeTaskStrip'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'artifact.runtimeStop': 'Stop',
      }
      return map[key] ?? key
    },
  }),
}))

const stopRuntimeTask = vi.fn()

vi.mock('@/domain', () => ({
  useActiveSessionId: () => mockSessionId,
  sessionService: { stopRuntimeTask: (...args: unknown[]) => stopRuntimeTask(...args) },
}))

let mockSessionId: string | null = 's1'
let mockTasks: Array<{
  id: string
  kind: 'shell' | 'agent' | 'monitor' | 'schedule'
  description: string
  status: string
}> = []

vi.mock('@/store/taskRuntimeStore', () => ({
  useTaskRuntimeStore: (sel: (s: unknown) => unknown) =>
    sel({ bySession: mockSessionId ? { [mockSessionId]: { tasks: Object.fromEntries(mockTasks.map((t) => [t.id, t])) } } : {} }),
  isKnownTaskKind: (k: string) => k === 'shell' || k === 'agent' || k === 'monitor' || k === 'schedule',
}))

function task(partial: Partial<(typeof mockTasks)[number]> = {}): (typeof mockTasks)[number] {
  return { id: 't1', kind: 'shell', description: 'e2e build', status: 'running', ...partial }
}

describe('RuntimeTaskStrip', () => {
  beforeEach(() => {
    mockSessionId = 's1'
    mockTasks = []
    stopRuntimeTask.mockClear()
  })

  afterEach(() => cleanup())

  it('renders nothing when there are no tasks', () => {
    render(<RuntimeTaskStrip />)
    expect(screen.queryByTestId('runtime-task-strip')).not.toBeInTheDocument()
  })

  it('renders running tasks with description and kind', () => {
    mockTasks = [task()]
    render(<RuntimeTaskStrip />)
    expect(screen.getByTestId('runtime-task-strip')).toBeInTheDocument()
    expect(screen.getByText('e2e build')).toBeInTheDocument()
    expect(screen.getByText('shell')).toBeInTheDocument()
  })

  it('hides completed tasks (only running/scheduled shown)', () => {
    mockTasks = [task({ status: 'completed' })]
    render(<RuntimeTaskStrip />)
    expect(screen.queryByTestId('runtime-task-strip')).not.toBeInTheDocument()
  })

  it('stop button stops the task via sessionService', () => {
    mockTasks = [task({ id: 't-stop' })]
    render(<RuntimeTaskStrip />)
    fireEvent.click(screen.getByTitle('Stop'))
    expect(stopRuntimeTask).toHaveBeenCalledWith('s1', 't-stop', 'user')
  })

  it('renders nothing without a session', () => {
    mockSessionId = null
    mockTasks = [task()]
    render(<RuntimeTaskStrip />)
    expect(screen.queryByTestId('runtime-task-strip')).not.toBeInTheDocument()
  })
})
