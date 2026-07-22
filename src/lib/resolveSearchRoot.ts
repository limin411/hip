import { workspaceModeOf } from '@/lib/workspaceMode'
import type { ProjectPathStatus } from '@/store/projectPathStore'

/**
 * Absolute project root for `@` file search, or null (do not open palette).
 * Never returns chat/sandbox scratch cwd — only explicit project workspaces.
 */
export function resolveSearchRoot(opts: {
  /** Active session config when present */
  sessionConfig?: {
    surface?: 'chat' | 'code'
    workspaceMode?: 'sandbox' | 'project'
    cwd?: string
  } | null
  /** NewConversation draft */
  draft?: { mode: 'project' | 'chat'; cwd?: string } | null
  pathStatus: ProjectPathStatus
}): string | null {
  if (opts.sessionConfig) {
    const mode = workspaceModeOf(opts.sessionConfig)
    if (mode !== 'project') return null
    const cwd = opts.sessionConfig.cwd?.trim()
    if (!cwd) return null
    // missing → no search; unknown → allow (fail-open while probe runs)
    if (opts.pathStatus === 'missing') return null
    return cwd
  }

  if (opts.draft?.mode === 'project') {
    const cwd = opts.draft.cwd?.trim()
    if (!cwd) return null
    if (opts.pathStatus === 'missing') return null
    return cwd
  }

  return null
}
