import { useDomainStore } from '@/domain'
import { useTaskRuntimeStore } from '@/store/taskRuntimeStore'

export interface ActiveWorkSummary {
  runningSessions: number
  runningTasks: number
  total: number
}

/** Snapshot of in-flight agent turns + TaskRuntime work (shell/monitor/agent/schedule). */
export function countActiveWork(): ActiveWorkSummary {
  const sessions = useDomainStore.getState().sessions
  const runningSessions = sessions.filter((s) => s.status === 'running').length

  let runningTasks = 0
  for (const sess of Object.values(useTaskRuntimeStore.getState().bySession)) {
    const c = sess.runningCounts
    runningTasks += (c.shell ?? 0) + (c.agent ?? 0) + (c.monitor ?? 0) + (c.schedule ?? 0)
  }

  return {
    runningSessions,
    runningTasks,
    total: runningSessions + runningTasks,
  }
}
