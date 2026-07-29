import type { MascotAction } from '@/components/login/MascotActor'
import type { ZoneId, ZoneState } from './workbenchTypes'

/** Default mascot clip for a zone state (spec table). */
const STATE_ACTION: Record<ZoneState, MascotAction> = {
  idle: 'sleepy',
  running: 'coding',
  blocked: 'deadline',
  done: 'success',
  fail: 'fail',
}

/** Light zone-specific overrides while running. */
const RUNNING_BY_ZONE: Partial<Record<ZoneId, MascotAction>> = {
  sessions: 'coding',
  tasks: 'review',
  automations: 'busy',
  knowledge: 'thinking',
  terminals: 'coffee_work',
  workflows: 'merge',
}

export function mascotForZone(zoneId: ZoneId, state: ZoneState): MascotAction {
  if (state === 'running') {
    return RUNNING_BY_ZONE[zoneId] ?? STATE_ACTION.running
  }
  return STATE_ACTION[state]
}

export function mascotForHero(state: ZoneState): MascotAction {
  if (state === 'running') return 'coding'
  if (state === 'blocked') return 'deadline'
  if (state === 'fail') return 'fail'
  if (state === 'done') return 'cheer'
  return 'wave'
}
