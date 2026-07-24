// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { useDomainStore } from '@/domain'
import { useTaskRuntimeStore } from '@/store/taskRuntimeStore'
import { countActiveWork } from './activeWork'

describe('countActiveWork', () => {
  beforeEach(() => {
    useDomainStore.setState({ sessions: [], activeSessionId: null } as never)
    useTaskRuntimeStore.setState({ bySession: {} })
  })

  it('returns zeros when idle', () => {
    expect(countActiveWork()).toEqual({
      runningSessions: 0,
      runningTasks: 0,
      total: 0,
    })
  })

  it('counts running sessions and runtime tasks', () => {
    useDomainStore.setState({
      sessions: [
        { id: 's1', status: 'running' },
        { id: 's2', status: 'idle' },
      ],
    } as never)
    useTaskRuntimeStore.setState({
      bySession: {
        s1: {
          tasks: {},
          runningCounts: { shell: 1, agent: 2, monitor: 0, schedule: 1 },
          events: {},
          selectedTaskId: null,
        },
      },
    })
    expect(countActiveWork()).toEqual({
      runningSessions: 1,
      runningTasks: 4,
      total: 5,
    })
  })
})
