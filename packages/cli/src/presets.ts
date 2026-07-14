import type { HitlMode, PermissionModeCli, PresetName, StreamMode } from './types.js'

export interface ResolvedPreset {
  permissionMode: PermissionModeCli
  disablePlan: boolean
  hitl: HitlMode
  incognito: boolean
  stream?: StreamMode
  useIsolation: boolean
  setHome: boolean
}

export function resolvePreset(
  preset: PresetName | undefined,
  flags: {
    permissionMode?: PermissionModeCli
    disablePlan?: boolean
    forcePlan?: boolean
    hitl?: HitlMode
    incognito?: boolean
    useUserHip?: boolean
    keepUserHome?: boolean
    stream?: StreamMode
  },
): ResolvedPreset {
  const base: ResolvedPreset = {
    permissionMode: 'full',
    disablePlan: true,
    hitl: 'auto',
    incognito: false,
    useIsolation: !flags.useUserHip,
    setHome: !flags.useUserHip && !flags.keepUserHome,
  }

  if (preset === 'harness') {
    base.permissionMode = 'full'
    base.disablePlan = true
    base.hitl = 'auto'
    base.incognito = true
    base.useIsolation = true
    base.setHome = true
    base.stream = flags.stream ?? 'none'
  } else if (preset === 'interactive') {
    base.permissionMode = 'edit'
    base.disablePlan = false
    base.hitl = 'prompt'
    base.incognito = false
    base.useIsolation = !flags.useUserHip
    base.setHome = !flags.useUserHip && !flags.keepUserHome
  } else if (preset === 'readonly') {
    base.permissionMode = 'chat'
    base.disablePlan = true
    base.hitl = 'fail'
    base.incognito = true
  }

  if (flags.permissionMode) base.permissionMode = flags.permissionMode
  if (flags.forcePlan) base.disablePlan = false
  else if (flags.disablePlan !== undefined) base.disablePlan = flags.disablePlan
  if (flags.hitl) base.hitl = flags.hitl
  if (flags.incognito !== undefined) base.incognito = flags.incognito
  if (flags.stream) base.stream = flags.stream
  if (flags.useUserHip) {
    base.useIsolation = false
    base.setHome = false
  }
  if (flags.keepUserHome) base.setHome = false

  return base
}
