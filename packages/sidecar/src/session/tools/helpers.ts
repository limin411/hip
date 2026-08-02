import { promises as fs } from 'node:fs'
import { promises as dns } from 'node:dns'
import * as path from 'node:path'
import type { PermissionMode, SkillMeta } from '@hip/protocol'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { resolveWithin } from '../workspace-fs.js'
import type { NetworkPolicy } from '../network-policy.js'

/** Directory basenames skipped by recursive file tools (grep/glob walks). */
export const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  // Windows junk / system trees that full-mode walks must never enter
  '$RECYCLE.BIN',
  'System Volume Information',
  'Recovery',
])
export const MAX_SCAN_FILE_BYTES = 256 * 1024
export const SCRIPT_TIMEOUT_MS = 120_000
export const SCRIPT_OUTPUT_CAP = 64 * 1024
export const WEB_OUTPUT_CAP = 64 * 1024

/** True when a directory basename should be skipped during recursive scans. */
export function isExcludedDirName(name: string): boolean {
  if (EXCLUDE_DIRS.has(name)) return true
  // Case variants on Windows (e.g. $Recycle.Bin)
  const upper = name.toUpperCase()
  return upper === '$RECYCLE.BIN' || upper === 'SYSTEM VOLUME INFORMATION'
}

/** Clip text to `cap` bytes, appending a truncation note when shortened. */
export function clipText(text: string, cap: number): string {
  if (text.length <= cap) return text
  return text.slice(0, cap) + `\n…(output truncated to ${Math.round(cap / 1024)}KB)`
}

/** Check if an IPv4 or IPv6 address belongs to a private/internal network. */
export function isPrivateIp(ip: string): boolean {
  // IPv4-mapped IPv6: ::ffff:x.x.x.x
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (v4Mapped) return isPrivateIp(v4Mapped[1])

  // IPv6 unspecified
  if (ip === '::' || ip === '0:0:0:0:0:0:0:0') return true

  // IPv4 classification
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  const nums = parts.map(Number)
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return false

  const [a, b, c, d] = nums
  if (a === 0 && b === 0 && c === 0 && d === 0) return true // 0.0.0.0
  if (a === 10) return true // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 127) return true // 127.0.0.0/8
  if (a === 169 && b === 254) return true // 169.254.0.0/16 (link-local)

  return false
}

/**
 * Validate a URL for SSRF before fetching. Returns null if safe, or an
 * error string describing the rejection reason.
 */
export async function validateFetchUrl(rawUrl: string): Promise<string | null> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return 'Error: invalid URL'
  }

  if (parsed.protocol !== 'https:') {
    return `Error: scheme "${parsed.protocol.replace(/:$/, '')}" is not allowed — only https:// is permitted`
  }

  const hostname = parsed.hostname

  // Reject bare IPv4 addresses
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isPrivateIp(hostname)) {
      return `Error: URL resolves to a private/internal IP address (${hostname})`
    }
    return 'Error: bare IP addresses are not allowed — use a hostname'
  }

  // Reject bare IPv6 addresses (with or without brackets)
  const cleanV6 = hostname.replace(/^\[|\]$/g, '')
  if (cleanV6.includes(':')) {
    if (isPrivateIp(cleanV6)) {
      return `Error: URL resolves to a private/internal IP address (${hostname})`
    }
    return 'Error: bare IP addresses are not allowed — use a hostname'
  }

  // Resolve hostname and check every returned address
  let addresses: string[]
  try {
    addresses = await dns.resolve(hostname)
  } catch {
    return `Error: DNS resolution failed for "${hostname}"`
  }

  if (addresses.length === 0) {
    return `Error: DNS resolution returned no addresses for "${hostname}"`
  }

  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      return `Error: URL resolves to a private/internal IP address (${addr})`
    }
  }

  return null
}

/** True when `abs` is lexically under `root` (exact match or prefix + sep). */
function isUnderRoot(abs: string, root: string): boolean {
  return abs === root || abs.startsWith(root + path.sep)
}

/** Map "/abs-relative-to-root" → real fs path inside `root`. Lexical jail PLUS a symlink check on the
 *  deepest existing ancestor (so writing through a symlinked parent that escapes the root is rejected). */
export async function real(root: string, p: string): Promise<string> {
  const realRoot = await fs.realpath(root)
  const resolvedRoot = path.resolve(root)
  const normalizedP = path.normalize(p)
  // The model can pass either the documented root-relative form ("/index.html")
  // or an absolute path that is already under the project root. On macOS the
  // temporary directory is a symlink (/var/folders/... -> /private/var/folders/...),
  // so compare against the *real* root after realpath, not the lexical root.
  //
  // Critical: new writes target non-existent paths. fs.realpath(leaf) fails then,
  // so we also accept absolute paths that are *lexically* under root/realRoot —
  // otherwise "/Users/.../scratch/session/out.html" is mis-handled as root-relative
  // and lands at root/Users/.../out.html, while write confirmation + preview still
  // cite the original path → "cannot preview this file".
  let realInput: string | undefined
  try { realInput = await fs.realpath(normalizedP) } catch { realInput = undefined }

  let candidate: string
  if (path.isAbsolute(normalizedP) || path.isAbsolute(p)) {
    const abs = path.resolve(normalizedP)
    const underExisting =
      realInput !== undefined && isUnderRoot(realInput, realRoot)
    const underLexical =
      isUnderRoot(abs, realRoot) || isUnderRoot(abs, resolvedRoot)
    if (underExisting || underLexical) {
      candidate = underExisting ? normalizedP : abs
    } else if (normalizedP.startsWith('/') || normalizedP.startsWith('\\')) {
      // Documented project-root form ("/index.html") or absolute outside root → jail under root.
      candidate = path.join(root, normalizedP.replace(/^[\/\\]+/, ''))
    } else {
      candidate = path.join(root, normalizedP)
    }
  } else {
    candidate = path.join(root, normalizedP)
  }

  const lexical = resolveWithin(root, candidate)
  let probe = lexical
  // find the deepest existing ancestor (the leaf may not exist yet for writes)
  for (;;) {
    try { await fs.access(probe); break } catch { const parent = path.dirname(probe); if (parent === probe) break; probe = parent }
  }
  let realProbe: string
  try { realProbe = await fs.realpath(probe) } catch { return lexical }
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) {
    throw new Error(`path escapes project root via symlink: ${p}`)
  }
  return lexical
}

/** Canonicalize an ABSOLUTE path and confirm it resolves to within one of `skillDirs` (exact dir or
 *  under dir + sep), with a realpath/symlink guard so a symlinked bundled file can't escape its skill
 *  dir. Returns the real path on success, or null if the path is not under any skill dir. Skills are
 *  read-only and live OUTSIDE the project root (~/.hip/skills/<id>), so this is a read_file-only seam
 *  parallel to `real()` — it widens nothing else. */
export async function realInSkill(skillDirs: string[], p: string): Promise<string | null> {
  if (!path.isAbsolute(p)) return null
  let realPath: string
  try { realPath = await fs.realpath(p) } catch { return null }
  for (const dir of skillDirs) {
    let realDir: string
    try { realDir = await fs.realpath(dir) } catch { continue }
    if (realPath === realDir || realPath.startsWith(realDir + path.sep)) return realPath
  }
  return null
}

/**
 * Resolve a model-supplied path in 'full' (un-jailed) mode.
 * No symlink/escape check — 'full' is an explicit "all directories" grant.
 *
 * Semantics (aligned with the full-mode cwd prompt):
 * - Relative paths resolve against `cwd`
 * - Bare `/` or `\` means the project root (`cwd`), never the OS drive/FS root
 * - On Windows, `/src/foo`-style paths are project-root form (not `D:\src\foo`);
 *   only drive-letter (`C:\...`) and UNC (`\\server\share`) paths stay as OS absolute
 * - On POSIX, real absolute paths (`/Users/...`, `/tmp/...`) stay as-is so full mode
 *   can reach outside the project
 */
export function resolveFull(cwd: string, p: string): string {
  // Project-root sentinel used throughout hip prompts and default tool paths.
  if (p === '/' || p === '\\' || p === '') {
    return path.resolve(cwd)
  }
  if (process.platform === 'win32') {
    // Drive letter (C:\...) or UNC (\\server\share or //server/share)
    if (/^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]{2}/.test(p)) {
      return path.normalize(p)
    }
    // Leading-slash paths are the project-relative absolute form from prompts
    // ("/src/a.ts"), not the Windows drive root — join under cwd.
    if (p.startsWith('/') || p.startsWith('\\')) {
      return path.resolve(cwd, p.replace(/^[\\/]+/, ''))
    }
    return path.resolve(cwd, p)
  }
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(cwd, p)
}

export function splitArgs(input: string): { positional: string[]; named: Record<string, string> } {
  const words: string[] = []
  let current = ''
  let inQuote: string | null = null

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (inQuote) {
      if (ch === inQuote) { inQuote = null }
      else { current += ch }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch
    } else if (ch === ' ' || ch === '\t') {
      if (current.length > 0) { words.push(current); current = '' }
    } else {
      current += ch
    }
  }
  if (current.length > 0) words.push(current)

  const positional: string[] = []
  const named: Record<string, string> = {}
  for (const word of words) {
    const eqIdx = word.indexOf('=')
    if (eqIdx > 0) { named[word.slice(0, eqIdx)] = word.slice(eqIdx + 1) }
    else { positional.push(word) }
  }
  return { positional, named }
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function substituteSkillBody(
  body: string,
  args: string | undefined,
  skillArgs: Array<{ name: string; description: string; required?: boolean }> | undefined,
  skillDir: string,
  sessionId: string | undefined,
): string {
  let result = body
  const parsed = args != null ? splitArgs(args) : { positional: [] as string[], named: {} as Record<string, string> }

  result = result.replace(/\\\$/g, '\x00ESC\x00')

  result = result.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    if (name === 'HIP_SKILL_DIR') return skillDir
    if (name === 'HIP_SESSION_ID') return sessionId ?? ''
    return `\${${name}}`
  })

  result = result.replace(/\$ARGUMENTS/g, args ?? '')

  if (skillArgs && skillArgs.length > 0) {
    const namedValues: Record<string, string> = {}
    const hasExplicitNamed = Object.keys(parsed.named).length > 0

    for (let i = 0; i < skillArgs.length; i++) {
      const sa = skillArgs[i]
      if (hasExplicitNamed && sa.name in parsed.named) {
        namedValues[sa.name] = parsed.named[sa.name]
      } else if (parsed.positional[i] !== undefined) {
        namedValues[sa.name] = parsed.positional[i]
      }
    }

    for (const [name, value] of Object.entries(namedValues)) {
      result = result.replace(new RegExp(`\\$${escapeRegex(name)}(?!\\w)`, 'g'), value)
    }
  }

  result = result.replace(/\$(\d+)/g, (_, n: string) => {
    const idx = Number(n)
    return parsed.positional[idx] ?? `$${n}`
  })

  result = result.replace(/\x00ESC\x00/g, '$')

  if (args != null && args.trim().length > 0 && !body.includes('$ARGUMENTS')) {
    result += `\n\nArguments: ${args}`
  }

  return result
}

/** Minimal glob: `**` matches any chars incl. `/`; `*` matches any chars except `/`. Anchored full-match. */
export function toGlobRegex(pattern: string, caseInsensitive?: boolean): RegExp {
  const rx = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, ' ')
    .replace(/\*/g, '[^/]*')
    .replace(/ /g, '.*')
  const flags = caseInsensitive ? 'i' : ''
  return new RegExp(`^${rx.startsWith('/') ? '' : '.*'}${rx}$`, flags)
}

/**
 * Slice a text file by 1-based line offset and optional line limit.
 * When the slice does not reach EOF, appends a continuation hint.
 */
export function sliceFileLines(
  text: string,
  offset?: number,
  limit?: number,
): { text: string; totalLines: number } {
  const lines = text.split('\n')
  const totalLines = lines.length
  const start = offset !== undefined ? Math.max(0, Math.floor(offset) - 1) : 0
  if (start >= totalLines) {
    return {
      text: `Error: offset ${offset} is past end of file (${totalLines} lines)`,
      totalLines,
    }
  }
  const end =
    limit !== undefined ? Math.min(totalLines, start + Math.max(0, Math.floor(limit))) : totalLines
  const body = lines.slice(start, end).join('\n')
  if (end < totalLines) {
    return {
      text:
        body +
        `\n\n…[lines ${start + 1}-${end} of ${totalLines}; use offset=${end + 1} to continue]`,
      totalLines,
    }
  }
  return { text: body, totalLines }
}

const GREP_INLINE_FLAGS = /^\(\?([ims]+)\)/
const GREP_INVALID_HINT =
  'Hint: This tool uses JavaScript RegExp. Do not use PCRE flags like (?i); set caseInsensitive=true instead.'

export type CompileGrepResult =
  | { ok: true; re: RegExp; notes: string[] }
  | { ok: false; error: string }

/**
 * Build a JS RegExp for the grep tool. Strips common PCRE-style leading inline flags
 * (e.g. `(?i)`) that models often emit but JavaScript does not accept as groups.
 */
export function compileGrepPattern(pattern: string, caseInsensitive?: boolean): CompileGrepResult {
  let body = pattern
  const notes: string[] = []
  const flagSet = new Set<string>()

  const m = body.match(GREP_INLINE_FLAGS)
  if (m) {
    body = body.slice(m[0].length)
    for (const ch of m[1]) {
      if (ch === 'i' || ch === 'm' || ch === 's') flagSet.add(ch)
    }
    if (m[1].includes('i')) {
      notes.push('stripped PCRE-style (?i); used case-insensitive flag instead')
    } else {
      notes.push(`stripped PCRE-style (?${m[1]}); mapped to JavaScript RegExp flags`)
    }
  }

  if (caseInsensitive) flagSet.add('i')

  const flags = [...flagSet].join('')
  try {
    return { ok: true, re: new RegExp(body, flags), notes }
  } catch (err) {
    return {
      ok: false,
      error: `Error: invalid regex: ${(err as Error).message}\n${GREP_INVALID_HINT}`,
    }
  }
}

/** A resolved HITL decision for run_script. `kind` is the SEMANTIC of the chosen option
 *  (allow_once|allow_always|reject_once|reject_always) — NOT the opaque agent/UI optionId.
 *  This mirrors the codebase convention (PermissionOption.kind, PermissionModal): optionId is an
 *  opaque advertised identifier; the allow-vs-reject meaning lives in `kind`. The future session.ts
 *  wiring MUST map the UI's returned optionId back to its PermissionOption.kind before resolving. */
export type ApprovalDecision = { kind: string } | { cancelled: true }

/** HITL approval seam for run_script. session.ts supplies a closure that registers a pending
 *  permission and resolves on the user's choice (as an ApprovalDecision); tests supply a fake.
 *  `toolName` is the canonical tool identifier (e.g. 'run_script') for hook matching; `title` is the
 *  user-facing prompt title. */
export type ApprovalFn = (req: {
  title: string
  toolName?: string
  kind: string
  content?: string
  /** Extra bridge metadata (e.g. terminal_exec waitMs / callId). */
  meta?: Record<string, unknown>
}) => Promise<ApprovalDecision>

export interface DispatchSpec {
  agents: Array<{ id: string; name: string; description?: string }>
  signal?: AbortSignal
  run: (agentId: string, task: string, signal?: AbortSignal) => Promise<string>
}

export interface BuildToolsOpts {
  /** Namespaced MCP tools (mcp__<server>__<tool>) merged onto hip's own loop. */
  mcpTools?: StructuredToolInterface[]
  /** Enabled skills — when non-empty, adds the use_skill tool. */
  skills?: SkillMeta[]
  /** When present, adds the HITL-gated run_script tool. */
  requestApproval?: ApprovalFn
  /** Conversation permission mode. 'chat' = read-only (no write/edit + no run_script, reads jailed);
   *  'edit' = DEFAULT (write/edit jailed to root); 'full' = file tools un-jailed (any absolute path).
   *  Defaults to 'edit'. Unknown values are treated as 'edit'. MCP tools are unaffected by mode;
   *  run_script is dropped in chat mode (it would let a read-only agent mutate the project). */
  permissionMode?: PermissionMode
  /**
   * Product surface. Chat further clamps git/plugin tools even when permissionMode
   * allows writes (artifact writes stay; project mutation tools do not).
   */
  surface?: 'chat' | 'code' | 'knowledge' | 'terminal'
  /** Terminal shared-PTY bridge (terminal surface only). */
  terminalUiBridge?: {
    send: (msg: import('@hip/protocol').ServerMessage) => void
    pendingUiTool: Map<
      string,
      (
        result:
          | import('@hip/protocol').UiToolResultPayload
          | import('@hip/protocol').UiToolReadResultPayload
          | import('@hip/protocol').UiToolWriteResultPayload,
      ) => void
    >
  }
  /** Enable web_search and web_fetch tools. web_search uses Exa MCP (free tier, no key required)
   *  with DDG Instant Answer fallback. Set HIP_EXA_API_KEY for higher Exa rate limits. */
  webSearchEnabled?: boolean
  /** Enable generate_agent tool that calls generateAgentConfig to produce an AgentConfig JSON. */
  generateAgentEnabled?: boolean
  /** Session ID for skill body substitution (${HIP_SESSION_ID}). */
  sessionId?: string
  /** When non-empty, keep only tools whose name is in this list (applied after PermissionMode). */
  allowedTools?: string[]
  /** When non-empty, remove tools whose name is in this list (applied after PermissionMode). */
  blockedTools?: string[]
  /** Optional network policy applied to web_fetch/web_search before the SSRF check. */
  networkPolicy?: NetworkPolicy
    /** Enable the read_media tool for images and video frame extraction.
   *  Only enable when the active model supports vision. */
  mediaEnabled?: boolean
  /** PlanMode instance for Enter/Exit plan-mode tools. */
  planMode?: import('../plan-mode.js').PlanMode
  /**
   * Session checkpoint list for git_checkpoint_list (hip shadow refs are invisible
   * to plain git). When absent, checkpoint tools are not registered.
   */
  onCheckpointList?: () => Promise<import('@hip/protocol').Checkpoint[]>
  /**
   * Exact safe revert for git_checkpoint_revert (safety checkpoint + worktree-only,
   * same path as the removed Timeline panel revert). When absent, not registered.
   */
  onCheckpointRevert?: (checkpointId: string) => Promise<{ ok: boolean; safetyCheckpointId?: string; error?: string }>
  /** TaskRuntime for background shells / monitor / wait_tasks. */
  taskRuntime?: import('../background-manager.js').BackgroundManager
  /** Cron manager for scheduler tools (when not registered separately). */
  cronManager?: import('../cron.js').CronManager
  /** Idle activity pulse during FG run_script. */
  onActivity?: () => void
  /** Abort signal for FG tools. */
  signal?: AbortSignal
  originTurnId?: string | null
  /** Feature gates (default on when runtime present). */
  shellBackgroundEnabled?: boolean
  monitorEnabled?: boolean
  schedulerWakeEnabled?: boolean
}

/** True for an allow decision (run_script may execute). Keys off the decision's SEMANTIC `kind`
 *  (allow_*), consistent with PermissionModal/PermissionOption.kind — NOT the opaque optionId.
 *  Anything that is not an explicit allow_* (reject_*, cancel, or an unknown kind) ⇒ false. */
export function isApproved(d: ApprovalDecision): boolean {
  return 'kind' in d && d.kind.startsWith('allow')
}

/** Tools whose approval logic is embedded in the tool implementation itself
 *  (via requestApproval), rather than being gated by a pre-execution policy
 *  check. Currently only run_script — the tool fires, asks the user, and
 *  respects the answer. */
export const SELF_GATED_TOOLS: Set<string> = new Set([
  'run_script',
  'terminal_exec',
  'monitor',
  'EnterPlanMode',
])
