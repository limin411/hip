import type { MascotAction } from '@/components/login/MascotActor'
import type { ZoneId, ZoneState } from './workbenchTypes'

/**
 * Farm-field mascot clips — hot-sun tending vibe, not desk coding.
 * Still pure + table-driven for tests.
 */
const STATE_ACTION: Record<ZoneState, MascotAction> = {
  idle: 'hot',
  running: 'run',
  blocked: 'thirsty',
  done: 'cheer',
  fail: 'melt',
}

/** Zone flavour while tending (running). */
const RUNNING_BY_ZONE: Partial<Record<ZoneId, MascotAction>> = {
  sessions: 'sprint',
  tasks: 'jog',
  automations: 'busy',
  knowledge: 'thinking',
  terminals: 'coffee',
  workflows: 'stretch',
}

const IDLE_BY_ZONE: Partial<Record<ZoneId, MascotAction>> = {
  sessions: 'sleepy',
  tasks: 'stretch',
  automations: 'away',
  knowledge: 'sunny',
  terminals: 'coffee',
  workflows: 'yoga',
}

const DONE_BY_ZONE: Partial<Record<ZoneId, MascotAction>> = {
  sessions: 'thumbs_up',
  tasks: 'champion',
  automations: 'success',
  knowledge: 'proud',
  terminals: 'yummy',
  workflows: 'victory_lap',
}

export function mascotForZone(zoneId: ZoneId, state: ZoneState): MascotAction {
  if (state === 'running') {
    return RUNNING_BY_ZONE[zoneId] ?? STATE_ACTION.running
  }
  if (state === 'idle') {
    return IDLE_BY_ZONE[zoneId] ?? STATE_ACTION.idle
  }
  if (state === 'done') {
    return DONE_BY_ZONE[zoneId] ?? STATE_ACTION.done
  }
  return STATE_ACTION[state]
}

export function mascotForHero(state: ZoneState): MascotAction {
  if (state === 'running') return 'run'
  if (state === 'blocked') return 'thirsty'
  if (state === 'fail') return 'melt'
  if (state === 'done') return 'cheer'
  return 'wave'
}
