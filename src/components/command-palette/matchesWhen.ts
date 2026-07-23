import type { SessionVM } from '@/domain'
import type { ActiveView } from '@/store/uiStore'
import type { CommandWhen } from './types'

export type WhenContext = {
  activeView: ActiveView
  sessionId: string | null
  sessions: SessionVM[]
}

/**
 * Resolve chat|code surface for palette visibility.
 * chat/code views map directly; other views use the bound session's surface.
 */
export function resolvePaletteSurface(ctx: WhenContext): 'chat' | 'code' | null {
  if (ctx.activeView === 'code') return 'code'
  if (ctx.activeView === 'chat') return 'chat'
  if (!ctx.sessionId) return null
  const session = ctx.sessions.find((s) => s.id === ctx.sessionId)
  const surface = session?.config?.surface
  if (surface === 'code' || surface === 'chat') return surface
  return null
}

/** Whether a command's `when` clause matches the current palette context. */
export function matchesWhen(when: CommandWhen | undefined, ctx: WhenContext): boolean {
  if (!when) return true
  if (when.enabled === false) return false
  if (when.views && !when.views.includes(ctx.activeView)) return false
  if (when.requiresSession && !ctx.sessionId) return false
  if (when.surfaces && when.surfaces.length > 0) {
    const surface = resolvePaletteSurface(ctx)
    if (!surface || !when.surfaces.includes(surface)) return false
  }
  return true
}
