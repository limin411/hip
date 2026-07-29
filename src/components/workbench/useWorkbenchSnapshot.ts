import { useMemo } from 'react'
import { useDomainStore } from '@/domain'
import { countActiveWork } from '@/lib/activeWork'
import { useAutomationStore, listInFlightIds } from '@/store/automationStore'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTaskRuntimeStore } from '@/store/taskRuntimeStore'
import { useWorkItemStore } from '@/store/workItemStore'
import { AUTOMATION_PAGE } from '@/components/automation/feature'
import { TERMINAL_MANAGEMENT } from '@/components/terminals/feature'
import { WORK_ITEM_TRACKING } from '@/components/work-items/feature'
import type { WorkbenchSnapshot } from './workbenchTypes'

/** Subscribe stores and build a WorkbenchSnapshot for pure zoneProgress. */
export function useWorkbenchSnapshot(): WorkbenchSnapshot {
  const sessions = useDomainStore((s) => s.sessions)
  const workItems = useWorkItemStore((s) => s.items)
  const automations = useAutomationStore((s) => s.automations)
  const spaces = useKnowledgeStore((s) => s.spaces)
  const managedTerminals = useManagedTerminalStore((s) => s.terminals)
  // Re-render when any session runtime counts change.
  const runtimeBySession = useTaskRuntimeStore((s) => s.bySession)

  return useMemo(() => {
    const runningSessions = sessions.filter((s) => s.status === 'running').length
    const active = countActiveWork()

    let todo = 0
    let inProgress = 0
    let done = 0
    let cancelled = 0
    let latestCompletedAt: number | null = null
    for (const it of workItems) {
      if (it.archivedAt) continue
      if (it.status === 'todo') todo += 1
      else if (it.status === 'in_progress') inProgress += 1
      else if (it.status === 'done') {
        done += 1
        if (it.completedAt != null) {
          latestCompletedAt =
            latestCompletedAt == null
              ? it.completedAt
              : Math.max(latestCompletedAt, it.completedAt)
        }
      } else if (it.status === 'cancelled') cancelled += 1
    }

    let failedLast = 0
    let waitingUser = 0
    let enabled = 0
    for (const a of automations) {
      if (!a.enabled) continue
      enabled += 1
      if (a.lastStatus === 'failed') failedLast += 1
      if (a.lastStatus === 'waiting_user') waitingUser += 1
    }
    const inFlight = listInFlightIds().length

    let runningShells = 0
    for (const sess of Object.values(runtimeBySession)) {
      runningShells += sess.runningCounts.shell ?? 0
    }

    return {
      nowMs: Date.now(),
      flags: {
        workItems: WORK_ITEM_TRACKING,
        automations: AUTOMATION_PAGE,
        terminals: TERMINAL_MANAGEMENT,
        workflows: false,
      },
      sessions: {
        runningCount: runningSessions,
        activeWorkTotal: active.total,
      },
      tasks: {
        todo,
        inProgress,
        done,
        cancelled,
        latestCompletedAt,
      },
      automations: {
        enabled,
        inFlight,
        failedLast,
        waitingUser,
      },
      knowledge: {
        spaceCount: spaces.length,
      },
      terminals: {
        activeCount: managedTerminals.length,
        runningShells,
      },
    }
  }, [sessions, workItems, automations, spaces, managedTerminals, runtimeBySession])
}
