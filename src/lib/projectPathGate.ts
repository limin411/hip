import { surfaceOf } from '@/lib/sessions'
import type { ProjectPathStatus } from '@/store/projectPathStore'

export type ProjectPathBlockReason = 'none' | 'unbound' | 'missing'

/**
 * Code (project) sessions require a live workspace folder.
 * Chat/sandbox is never blocked here.
 */
export function projectPathBlockReason(
  config: Parameters<typeof surfaceOf>[0],
  pathStatus: ProjectPathStatus,
): ProjectPathBlockReason {
  if (surfaceOf(config) !== 'code') return 'none'
  if (!config.cwd?.trim()) return 'unbound'
  if (pathStatus === 'missing') return 'missing'
  return 'none'
}

export function isProjectPathBlocked(
  config: Parameters<typeof surfaceOf>[0],
  pathStatus: ProjectPathStatus,
): boolean {
  return projectPathBlockReason(config, pathStatus) !== 'none'
}
