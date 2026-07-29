import {
  WORKBENCH_DONE_WINDOW_MS,
  ZONE_STATE_PRIORITY,
  type HeroModel,
  type WorkbenchSnapshot,
  type ZoneId,
  type ZoneModel,
  type ZoneState,
} from './workbenchTypes'
import { mascotForHero, mascotForZone } from './mascotForZone'

function maxState(a: ZoneState, b: ZoneState): ZoneState {
  return ZONE_STATE_PRIORITY[a] >= ZONE_STATE_PRIORITY[b] ? a : b
}

function withinDoneWindow(
  latestCompletedAt: number | null,
  nowMs: number,
  windowMs: number,
): boolean {
  if (latestCompletedAt == null) return false
  return nowMs - latestCompletedAt <= windowMs
}

function buildSessions(snap: WorkbenchSnapshot): ZoneModel {
  const running = snap.sessions.runningCount
  const state: ZoneState = running > 0 ? 'running' : 'idle'
  return {
    id: 'sessions',
    state,
    labelKey: 'workbench.zone.sessions',
    progress: null,
    primaryMetricKey:
      running > 0 ? 'workbench.metric.sessionsRunning' : 'workbench.metric.sessionsIdle',
    primaryMetricValues: running > 0 ? { count: running } : undefined,
    secondaryMetricKey: 'workbench.metric.sessionsSecondary',
    secondaryMetricValues: { count: snap.sessions.activeWorkTotal },
    hrefView: 'chat',
    hrefHint: 'last-session',
    accentClass: 'border-t-[var(--role-supervisor)]',
    mascotAction: mascotForZone('sessions', state),
  }
}

function buildTasks(snap: WorkbenchSnapshot): ZoneModel | null {
  if (!snap.flags.workItems) return null
  const { todo, inProgress, done, latestCompletedAt } = snap.tasks
  // cancelled intentionally excluded from progress denominator (spec)
  const open = todo + inProgress
  const total = todo + inProgress + done
  const windowMs = snap.doneWindowMs ?? WORKBENCH_DONE_WINDOW_MS

  let state: ZoneState = 'idle'
  if (inProgress > 0) state = 'running'
  else if (open === 0 && done > 0 && withinDoneWindow(latestCompletedAt, snap.nowMs, windowMs)) {
    state = 'done'
  } else if (open === 0 && done > 0) {
    state = 'idle'
  }

  const progress = total > 0 ? done / total : null

  return {
    id: 'tasks',
    state,
    labelKey: 'workbench.zone.tasks',
    progress,
    primaryMetricKey: 'workbench.metric.tasksProgress',
    primaryMetricValues: { done, total },
    secondaryMetricKey:
      inProgress > 0 ? 'workbench.metric.tasksInProgress' : 'workbench.metric.tasksOpen',
    secondaryMetricValues: { count: inProgress > 0 ? inProgress : open },
    hrefView: 'tasks',
    hrefHint: 'none',
    accentClass: 'border-t-[var(--role-coder)]',
    mascotAction: mascotForZone('tasks', state),
  }
}

function buildAutomations(snap: WorkbenchSnapshot): ZoneModel | null {
  if (!snap.flags.automations) return null
  const { enabled, inFlight, failedLast, waitingUser } = snap.automations

  let state: ZoneState = 'idle'
  if (failedLast > 0) state = 'fail'
  else if (waitingUser > 0) state = 'blocked'
  else if (inFlight > 0) state = 'running'

  return {
    id: 'automations',
    state,
    labelKey: 'workbench.zone.automations',
    progress: null,
    primaryMetricKey:
      state === 'fail'
        ? 'workbench.metric.automationsFailed'
        : state === 'blocked'
          ? 'workbench.metric.automationsWaiting'
          : state === 'running'
            ? 'workbench.metric.automationsRunning'
            : 'workbench.metric.automationsIdle',
    primaryMetricValues:
      state === 'fail'
        ? { count: failedLast }
        : state === 'blocked'
          ? { count: waitingUser }
          : state === 'running'
            ? { count: inFlight }
            : { count: enabled },
    secondaryMetricKey: 'workbench.metric.automationsEnabled',
    secondaryMetricValues: { count: enabled },
    hrefView: 'automation',
    hrefHint: 'none',
    accentClass: 'border-t-[var(--role-reviewer)]',
    mascotAction: mascotForZone('automations', state),
  }
}

function buildKnowledge(snap: WorkbenchSnapshot): ZoneModel {
  const state: ZoneState = 'idle'
  return {
    id: 'knowledge',
    state,
    labelKey: 'workbench.zone.knowledge',
    progress: null,
    primaryMetricKey: 'workbench.metric.knowledgeSynced',
    secondaryMetricKey: 'workbench.metric.knowledgeSpaces',
    secondaryMetricValues: { count: snap.knowledge.spaceCount },
    hrefView: 'knowledge',
    hrefHint: 'none',
    accentClass: 'border-t-[var(--role-planner)]',
    mascotAction: mascotForZone('knowledge', state),
  }
}

function buildTerminals(snap: WorkbenchSnapshot): ZoneModel | null {
  if (!snap.flags.terminals) return null
  const { activeCount, runningShells } = snap.terminals
  const busy = runningShells > 0 || activeCount > 0
  const state: ZoneState = runningShells > 0 ? 'running' : activeCount > 0 ? 'idle' : 'idle'

  return {
    id: 'terminals',
    state: runningShells > 0 ? 'running' : 'idle',
    labelKey: 'workbench.zone.terminals',
    progress: null,
    primaryMetricKey:
      runningShells > 0
        ? 'workbench.metric.terminalsRunning'
        : busy
          ? 'workbench.metric.terminalsOpen'
          : 'workbench.metric.terminalsIdle',
    primaryMetricValues:
      runningShells > 0
        ? { count: runningShells }
        : activeCount > 0
          ? { count: activeCount }
          : undefined,
    secondaryMetricKey: 'workbench.metric.terminalsSecondary',
    secondaryMetricValues: { count: activeCount },
    hrefView: 'terminals',
    hrefHint: 'none',
    accentClass: 'border-t-[var(--role-worker)]',
    mascotAction: mascotForZone('terminals', state),
  }
}

/** Pure: snapshot → ordered zone cards (flag-filtered). */
export function buildZoneModels(snap: WorkbenchSnapshot): ZoneModel[] {
  const zones: Array<ZoneModel | null> = [
    buildSessions(snap),
    buildTasks(snap),
    buildAutomations(snap),
    buildKnowledge(snap),
    buildTerminals(snap),
    // workflows: hidden until flags.workflows (KD-11)
  ]
  return zones.filter((z): z is ZoneModel => z != null)
}

/** Aggregate hero from visible zones. */
export function aggregateHero(zones: ZoneModel[]): HeroModel {
  let state: ZoneState = 'idle'
  let runningCount = 0
  let attentionCount = 0
  let doneCount = 0

  for (const z of zones) {
    state = maxState(state, z.state)
    if (z.state === 'running') runningCount += 1
    if (z.state === 'blocked' || z.state === 'fail') attentionCount += 1
    if (z.state === 'done') doneCount += 1
  }

  const titleKey =
    state === 'fail' || state === 'blocked'
      ? 'workbench.hero.titleAttention'
      : state === 'running'
        ? 'workbench.hero.titleRunning'
        : state === 'done'
          ? 'workbench.hero.titleDone'
          : 'workbench.hero.titleIdle'

  const subtitleKey =
    state === 'fail' || state === 'blocked'
      ? 'workbench.hero.subAttention'
      : state === 'running'
        ? 'workbench.hero.subRunning'
        : state === 'done'
          ? 'workbench.hero.subDone'
          : 'workbench.hero.subIdle'

  return {
    state,
    mascotAction: mascotForHero(state),
    titleKey,
    subtitleKey,
    runningCount,
    attentionCount,
    doneCount,
  }
}

export function zoneById(zones: ZoneModel[], id: ZoneId): ZoneModel | undefined {
  return zones.find((z) => z.id === id)
}
