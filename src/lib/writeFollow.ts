import { parseToolInput } from './toolPresentation'

const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'apply_patch'])

export function isWriteLikeTool(name: string): boolean {
  return WRITE_TOOLS.has(name)
}

/** Extract primary path from tool input JSON (write/edit/patch). */
export function pathFromToolInput(name: string, input: string): string | null {
  const args = parseToolInput(input)
  if (name === 'apply_patch') {
    // Best-effort: first path-like line or explicit path field
    const p = typeof args.path === 'string' ? args.path : ''
    if (p) return p
    const patch = typeof args.patch === 'string' ? args.patch : input
    const m = patch.match(/\*\*\* (?:Add|Update|Delete) File: (.+)/)
    return m?.[1]?.trim() || null
  }
  const path = args.path ?? args.file_path ?? args.filename ?? args.file
  return typeof path === 'string' && path.length > 0 ? path : null
}

/**
 * Whether auto-follow should open this write for the active session.
 * Paused when the user manually selected a different file this turn.
 */
export function shouldAutoFollowWrite(opts: {
  autoFollow: boolean
  followPaused: boolean
  isActiveSession: boolean
  toolName: string
  status: string
}): boolean {
  if (!opts.autoFollow || opts.followPaused || !opts.isActiveSession) return false
  if (opts.status !== 'finished') return false
  return isWriteLikeTool(opts.toolName)
}
