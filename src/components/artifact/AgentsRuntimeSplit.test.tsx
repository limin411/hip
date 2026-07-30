// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { TaskSnapshot } from '@hip/protocol'
import { useTaskRuntimeStore } from '@/store/taskRuntimeStore'
import { AgentsRuntimeSplit } from './AgentsRuntimeSplit'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/domain', () => ({
  useActiveMessages: () => [],
  useActiveSessionStatus: () => 'idle',
  useActiveSessionId: () => 'sess-1',
}))

vi.mock('./AgentDashboard', () => ({
  AgentDashboard: () => <div data-testid="agent-dashboard" />,
}))

vi.mock('./TasksPanel', () => ({
  TasksPanel: () => <div data-testid="tasks-panel" />,
}))

function seedTask(sessionId: string, task: TaskSnapshot) {
  useTaskRuntimeStore.setState({
    bySession: {
      [sessionId]: {
        tasks: { [task.id]: task },
        runningCounts: { shell: 0, agent: 0, monitor: 0, schedule: 0 },
        events: {},
        selectedTaskId: null,
      },
    },
  })
}

describe('AgentsRuntimeSplit', () => {
  beforeEach(() => {
    cleanup()
    useTaskRuntimeStore.setState({ bySession: {} })
  })
  afterEach(() => cleanup())

  it('hides Runtime pane when there are no tasks', () => {
    render(<AgentsRuntimeSplit />)
    expect(screen.getByTestId('agents-runtime-split')).toBeInTheDocument()
    expect(screen.getByTestId('agents-runtime-agents-full')).toBeInTheDocument()
    expect(screen.getByTestId('agent-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('agents-runtime-runtime-label')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tasks-panel')).not.toBeInTheDocument()
  })

  it('shows Runtime pane when the session has tasks', () => {
    seedTask('sess-1', {
      id: 't1',
      kind: 'shell',
      description: 'npm test',
      status: 'running',
      createdAt: 1,
      updatedAt: 2,
    })
    render(<AgentsRuntimeSplit />)
    expect(screen.getByTestId('agents-runtime-runtime-label')).toBeInTheDocument()
    expect(screen.getByTestId('tasks-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('agents-runtime-agents-full')).not.toBeInTheDocument()
  })
})
