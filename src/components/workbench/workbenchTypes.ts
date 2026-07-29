import type { MascotAction } from '@/components/login/MascotActor'
import type { ActiveView } from '@/store/uiStore'

export type ZoneId =
  | 'sessions'
  | 'tasks'
  | 'automations'
  | 'knowledge'
  | 'terminals'
  | 'workflows'

export type ZoneState = 'idle' | 'running' | 'blocked' | 'done' | 'fail'

/** Strict i18n keys for workbench Zone labels (TFunction-safe). */
export type ZoneLabelKey =
  | 'workbench.zone.sessions'
  | 'workbench.zone.tasks'
  | 'workbench.zone.automations'
  | 'workbench.zone.knowledge'
  | 'workbench.zone.terminals'
  | 'workbench.zone.workflows'

export type ZoneMetricKey =
  | 'workbench.metric.sessionsRunning'
  | 'workbench.metric.sessionsIdle'
  | 'workbench.metric.sessionsSecondary'
  | 'workbench.metric.tasksProgress'
  | 'workbench.metric.tasksInProgress'
  | 'workbench.metric.tasksOpen'
  | 'workbench.metric.automationsFailed'
  | 'workbench.metric.automationsWaiting'
  | 'workbench.metric.automationsRunning'
  | 'workbench.metric.automationsIdle'
  | 'workbench.metric.automationsEnabled'
  | 'workbench.metric.knowledgeSynced'
  | 'workbench.metric.knowledgeSpaces'
  | 'workbench.metric.terminalsRunning'
  | 'workbench.metric.terminalsOpen'
  | 'workbench.metric.terminalsIdle'
  | 'workbench.metric.terminalsSecondary'

export type HeroTitleKey =
  | 'workbench.hero.titleIdle'
  | 'workbench.hero.titleRunning'
  | 'workbench.hero.titleAttention'
  | 'workbench.hero.titleDone'
  | 'workbench.hero.greetingMorning'
  | 'workbench.hero.greetingAfternoon'
  | 'workbench.hero.greetingEvening'
  | 'workbench.hero.greetingNight'

export type HeroSubtitleKey =
  | 'workbench.hero.subIdle'
  | 'workbench.hero.subRunning'
  | 'workbench.hero.subAttention'
  | 'workbench.hero.subDone'

export type ZoneStateKey =
  | 'workbench.state.idle'
  | 'workbench.state.running'
  | 'workbench.state.blocked'
  | 'workbench.state.done'
  | 'workbench.state.fail'

export interface ZoneModel {
  id: ZoneId
  state: ZoneState
  labelKey: ZoneLabelKey
  /** 0–1; null when not computable. */
  progress: number | null
  primaryMetricKey: ZoneMetricKey
  primaryMetricValues?: Record<string, string | number>
  secondaryMetricKey?: ZoneMetricKey
  secondaryMetricValues?: Record<string, string | number>
  hrefView: ActiveView
  hrefHint?: 'last-session' | 'none'
  accentClass: string
  mascotAction: MascotAction
}

export interface HeroModel {
  state: ZoneState
  mascotAction: MascotAction
  titleKey: HeroTitleKey
  subtitleKey: HeroSubtitleKey
  runningCount: number
  attentionCount: number
  doneCount: number
}

/** Feature flags that gate zone visibility (pure snapshot). */
export interface WorkbenchFlags {
  workItems: boolean
  automations: boolean
  terminals: boolean
  /** P1: keep false until workflow run snapshot is stable. */
  workflows: boolean
}

export interface WorkbenchSnapshot {
  nowMs: number
  flags: WorkbenchFlags
  sessions: {
    runningCount: number
    /** countActiveWork().total — turns + runtime tasks */
    activeWorkTotal: number
  }
  tasks: {
    todo: number
    inProgress: number
    done: number
    cancelled: number
    /** Most recent completedAt among done items (ms), or null */
    latestCompletedAt: number | null
  }
  automations: {
    enabled: number
    inFlight: number
    /** Count of enabled automations with lastStatus failed */
    failedLast: number
    /** Count with lastStatus waiting_user */
    waitingUser: number
  }
  knowledge: {
    spaceCount: number
  }
  terminals: {
    activeCount: number
    runningShells: number
  }
  /** Optional recent success window for done → idle (default 15m). */
  doneWindowMs?: number
}

export const WORKBENCH_DONE_WINDOW_MS = 15 * 60 * 1000

export const ZONE_STATE_PRIORITY: Record<ZoneState, number> = {
  fail: 5,
  blocked: 4,
  running: 3,
  done: 2,
  idle: 1,
}
