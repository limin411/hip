import { parseToolInput } from './toolPresentation'

const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'apply_patch'])

/**
 * Shell / interpreter scripts commonly written only to execute once.
 * Product source (.ts/.tsx/.js/…) still auto-opens for review.
 */
const DEFER_PANEL_SCRIPT_EXT = /\.(py|sh|bash|zsh|rb|pl|ps1|cmd|bat)$/i

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

function basename(path: string): string {
  const norm = path.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  return i >= 0 ? norm.slice(i + 1) : norm
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Paths that look like throwaway / one-shot run material — never auto-open the
 * right panel (stdout in the transcript is the primary surface).
 */
export function isEphemeralRunScriptPath(path: string): boolean {
  if (!path) return false
  const norm = path.replace(/\\/g, '/')
  const base = basename(norm)

  // Absolute system temp
  if (/^\/(var\/)?tmp\//i.test(norm)) return true
  if (/^[a-zA-Z]:\/(users\/[^/]+\/)?appdata\/local\/temp\//i.test(norm)) return true

  // Well-known ephemeral directory segments (project-relative or absolute)
  if (/(^|\/)(\.hip\/(tmp|cache|run|scratch)|tmp|temp|scratch|oneoffs?|one-offs?)(\/|$)/i.test(norm)) {
    return true
  }

  // Filename prefixes / suffixes that mark one-shots
  if (/^(tmp|temp|scratch|oneoff|one-off|run)[-_.]/i.test(base)) return true
  if (/[-_](tmp|temp|scratch|oneoff)(\.|$)/i.test(base)) return true

  return false
}

/**
 * Script-like paths that may be "write then run" — defer panel open until turn
 * end; cancel if a run_script references the same file.
 */
export function isDeferredPanelOpenPath(path: string): boolean {
  if (!path || isEphemeralRunScriptPath(path)) return false
  return DEFER_PANEL_SCRIPT_EXT.test(basename(path))
}

/** How write-follow should treat the right panel for this path. */
export type WriteFollowPanelPolicy = 'immediate' | 'defer' | 'skip'

export function writeFollowPanelPolicy(path: string): WriteFollowPanelPolicy {
  if (isEphemeralRunScriptPath(path)) return 'skip'
  if (isDeferredPanelOpenPath(path)) return 'defer'
  return 'immediate'
}

/**
 * True when a run_script command appears to execute `filePath`
 * (full path or basename as a path-like token).
 */
export function runScriptReferencesPath(command: string, filePath: string): boolean {
  if (!command || !filePath) return false
  const norm = filePath.replace(/\\/g, '/')
  if (command.includes(filePath) || command.includes(norm)) return true
  const base = basename(norm)
  if (!base || base.length < 2) return false
  // Token boundary: whitespace, quotes, path seps, shell punctuation
  const re = new RegExp(`(?:^|[\\s'"\`=/])${escapeRegExp(base)}(?:$|[\\s'"\`;|&)])`)
  return re.test(command)
}

/** Extract shell command string from run_script tool input. */
export function commandFromRunScriptInput(input: string): string {
  const args = parseToolInput(input)
  const cmd = args.command ?? args.cmd
  return typeof cmd === 'string' ? cmd : ''
}

/**
 * Whether auto-follow should act on this write for the active session.
 * Skips ephemeral throwaway paths. Paused when the user manually selected a
 * different file or dismissed the panel this turn.
 */
export function shouldAutoFollowWrite(opts: {
  autoFollow: boolean
  followPaused: boolean
  panelDismissedThisTurn?: boolean
  isActiveSession: boolean
  toolName: string
  status: string
  path?: string | null
}): boolean {
  if (!opts.autoFollow || opts.followPaused || !opts.isActiveSession) return false
  if (opts.panelDismissedThisTurn) return false
  if (opts.status !== 'finished') return false
  if (!isWriteLikeTool(opts.toolName)) return false
  if (opts.path && isEphemeralRunScriptPath(opts.path)) return false
  return true
}
