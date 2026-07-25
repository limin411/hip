import type { ToolCall } from '@hip/protocol'

export const PATH_DISPLAY_MAX = 48
export const TASK_HINT_MAX = 48

export type ToolCategory =
  | 'search'
  | 'read'
  | 'browse'
  | 'edit'
  | 'shell'
  | 'delegate'
  | 'plan'
  | 'other'

const CATEGORY_BY_NAME: Record<string, ToolCategory> = {
  grep: 'search',
  web_search: 'search',
  read_file: 'read',
  read_media: 'read',
  ls: 'browse',
  glob: 'browse',
  web_fetch: 'browse',
  write_file: 'edit',
  edit_file: 'edit',
  run_script: 'shell',
  task: 'delegate',
  dispatch_agent: 'delegate',
  task_retry: 'delegate',
  task_stop: 'delegate',
  task_output: 'delegate',
  task_batch: 'delegate',
  write_todos: 'plan',
}

export function toolCategory(name: string): ToolCategory {
  return CATEGORY_BY_NAME[name] ?? 'other'
}

export function parseToolInput(input: string): Record<string, unknown> {
  if (!input) return {}
  try {
    const o = JSON.parse(input) as unknown
    if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>
  } catch {
    /* ignore */
  }
  return {}
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Middle-ellipsis for long paths; full string when short. */
export function shortenPath(path: string, max = PATH_DISPLAY_MAX): string {
  const p = path.replace(/\\/g, '/')
  if (p.length <= max) return p
  const keep = Math.max(8, Math.floor((max - 1) / 2))
  return `${p.slice(0, keep)}…${p.slice(-keep)}`
}

function basename(path: string): string {
  const norm = path.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  return i >= 0 ? norm.slice(i + 1) : norm
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

/**
 * One-line human title for a tool row / activity running state.
 * Prefer semantic args over raw tool name alone.
 */
export function toolTitleHint(tool: Pick<ToolCall, 'name' | 'input'>): string {
  const args = parseToolInput(tool.input)
  const name = tool.name

  if (name === 'grep') {
    const pattern = asString(args.pattern)
    const path = asString(args.path)
    if (pattern && path) return `grep "${clip(pattern, 32)}" · ${shortenPath(path, 28)}`
    if (pattern) return `grep "${clip(pattern, 40)}"`
    return 'grep'
  }
  if (name === 'glob') {
    const pattern = asString(args.pattern)
    return pattern ? `glob ${clip(pattern, 40)}` : 'glob'
  }
  if (name === 'ls') {
    const path = asString(args.path) || '.'
    return `ls ${shortenPath(path)}`
  }
  if (name === 'read_file' || name === 'write_file' || name === 'edit_file' || name === 'read_media') {
    const path = asString(args.path ?? args.file_path ?? args.filename ?? args.file)
    if (path) return `${name === 'read_file' ? 'read' : name} ${basename(path)}`
    return name
  }
  if (name === 'task' || name === 'dispatch_agent') {
    const desc = asString(args.description ?? args.task ?? args.prompt)
    if (desc) return clip(desc, TASK_HINT_MAX)
    const agent = asString(args.agent)
    return agent ? `${name} · ${agent}` : name
  }
  if (name === 'run_script') {
    const cmd = asString(args.command ?? args.cmd)
    return cmd ? `run ${clip(cmd, 40)}` : name
  }

  // Generic: first stringy path-like or interesting field
  for (const key of ['path', 'file_path', 'pattern', 'query', 'url', 'description', 'task']) {
    const v = asString(args[key])
    if (v) return `${name} ${clip(v, 36)}`
  }
  return name
}

export type ToolErrorKind = 'enotdir' | 'enoent' | 'generic'

export function classifyToolError(error: string): ToolErrorKind {
  const e = error.toLowerCase()
  if (e.includes('enotdir') || e.includes('not a directory')) return 'enotdir'
  if (e.includes('enoent') || e.includes('no such file')) return 'enoent'
  return 'generic'
}

/**
 * Extract a path-ish token from an ENOTDIR/ENOENT message or tool input.
 */
export function pathFromToolError(error: string, input?: string): string {
  const m =
    error.match(/scandir ['"]([^'"]+)['"]/i) ||
    error.match(/['"]([^'"]+\.[a-zA-Z0-9]+)['"]/) ||
    error.match(/:\s*(.+)$/)
  if (m?.[1]) return m[1].trim()
  if (input) {
    const args = parseToolInput(input)
    const p = asString(args.path ?? args.file_path)
    if (p) return p
  }
  return ''
}

/** i18n key suffix + interpolation for human tool errors. */
export function humanizeToolError(
  error: string,
  input?: string,
): { key: 'chat.tool.error.enotdir' | 'chat.tool.error.enoent' | 'chat.tool.error.generic'; path?: string; message: string } {
  const kind = classifyToolError(error)
  const path = pathFromToolError(error, input)
  if (kind === 'enotdir') {
    return {
      key: 'chat.tool.error.enotdir',
      path: path || undefined,
      message: path
        ? `Cannot search a file as a directory: ${shortenPath(path)}`
        : 'Cannot search a file as a directory',
    }
  }
  if (kind === 'enoent') {
    return {
      key: 'chat.tool.error.enoent',
      path: path || undefined,
      message: path ? `Path not found: ${shortenPath(path)}` : 'Path not found',
    }
  }
  const clipped = error.replace(/\s+/g, ' ').trim().slice(0, 240)
  return { key: 'chat.tool.error.generic', message: clipped || 'Tool failed' }
}
