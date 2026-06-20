import { promises as fs } from 'node:fs'
import { promises as dns } from 'node:dns'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { SkillMeta, PermissionMode } from '@hip/protocol'
import { resolveWithin } from './workspace-fs.js'
import { gitCommit, gitCreateBranch, gitSwitchBranch, createWorktree, listWorktrees, removeWorktree } from './workspace-git.js'
import { getWorktreesDir } from './worktree-config.js'
import { readSkillBody, listSkillFiles } from './skills/registry.js'
import { resolveDynamicContext } from './skills/dynamic-context.js'
import { generateAgentConfig } from './agents/generate.js'

const EXCLUDE_DIRS = new Set(['node_modules', '.git'])
const MAX_SCAN_FILE_BYTES = 256 * 1024
const SCRIPT_TIMEOUT_MS = 120_000
const SCRIPT_OUTPUT_CAP = 64 * 1024
const WEB_OUTPUT_CAP = 64 * 1024

/** Clip text to `cap` bytes, appending a truncation note when shortened. */
function clipText(text: string, cap: number): string {
  if (text.length <= cap) return text
  return text.slice(0, cap) + `\n…(output truncated to ${Math.round(cap / 1024)}KB)`
}

/** Check if an IPv4 or IPv6 address belongs to a private/internal network. */
function isPrivateIp(ip: string): boolean {
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
async function validateFetchUrl(rawUrl: string): Promise<string | null> {
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

/** Map "/abs-relative-to-root" → real fs path inside `root`. Lexical jail PLUS a symlink check on the
 *  deepest existing ancestor (so writing through a symlinked parent that escapes the root is rejected). */
async function real(root: string, p: string): Promise<string> {
  const rel = p.replace(/^\/+/, '')
  const lexical = resolveWithin(root, path.join(root, rel)) // throws on lexical (..) escape
  const realRoot = await fs.realpath(root)
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
async function realInSkill(skillDirs: string[], p: string): Promise<string | null> {
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

/** Resolve a model-supplied path in 'full' (un-jailed) mode. Absolute paths are taken AS-IS; relative
 *  paths resolve against `cwd`. No symlink/escape check — 'full' is an explicit "all directories" grant. */
function resolveFull(cwd: string, p: string): string {
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(cwd, p)
}

export interface DispatchSpec {
  agents: Array<{ id: string; name: string; description?: string }>
  run: (agentId: string, task: string) => Promise<string>
}

/** A resolved HITL decision for run_script. `kind` is the SEMANTIC of the chosen option
 *  (allow_once|allow_always|reject_once|reject_always) — NOT the opaque agent/UI optionId.
 *  This mirrors the codebase convention (PermissionOption.kind, PermissionModal): optionId is an
 *  opaque advertised identifier; the allow-vs-reject meaning lives in `kind`. The future session.ts
 *  wiring MUST map the UI's returned optionId back to its PermissionOption.kind before resolving. */
export type ApprovalDecision = { kind: string } | { cancelled: true }

/** HITL approval seam for run_script. session.ts supplies a closure that registers a pending
 *  permission and resolves on the user's choice (as an ApprovalDecision); tests supply a fake. */
export type ApprovalFn = (req: { title: string; kind: string; content?: string }) => Promise<ApprovalDecision>

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
  /** Enable web_search and web_fetch tools. Requires HIP_WEBSEARCH_API_KEY env var for web_search. */
  webSearchEnabled?: boolean
  /** Enable generate_agent tool that calls generateAgentConfig to produce an AgentConfig JSON. */
  generateAgentEnabled?: boolean
  /** Session ID for skill body substitution (${HIP_SESSION_ID}). */
  sessionId?: string
}

function splitArgs(input: string): { positional: string[]; named: Record<string, string> } {
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

function escapeRegex(s: string): string {
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

/** True for an allow decision (run_script may execute). Keys off the decision's SEMANTIC `kind`
 *  (allow_*), consistent with PermissionModal/PermissionOption.kind — NOT the opaque optionId.
 *  Anything that is not an explicit allow_* (reject_*, cancel, or an unknown kind) ⇒ false. */
function isApproved(d: ApprovalDecision): boolean {
  return 'kind' in d && d.kind.startsWith('allow')
}

/** Build the file-tool set sandboxed to `root`. Each returns a short string result for the model. */
export function buildTools(
  root: string,
  spawnSubagent?: (description: string, mode?: 'foreground' | 'background') => Promise<string>,
  cwd?: string,
  dispatch?: DispatchSpec,
  opts: BuildToolsOpts = {},
): StructuredToolInterface[] {
  // Enabled-skill dirs (~/.hip/skills/<id>), DISJOINT from the project root. read_file may ALSO reach
  // bundled reference files under these (read-only); every other path stays jailed to `root` via real().
  const skillDirs = (opts.skills ?? []).map((s) => s.dir)
  // Mode (default + dirty-data → 'edit'). 'full' un-jails file paths; 'chat' is read-only.
  const mode: PermissionMode = opts.permissionMode === 'chat' || opts.permissionMode === 'full' ? opts.permissionMode : 'edit'
  const isFull = mode === 'full'
  const pathRoot = cwd ?? root
  /** Resolve a model path under the active mode: 'full' un-jails (absolute as-is, relative vs cwd);
   *  otherwise the symlink-guarded jail to `root`. */
  const resolvePath = (p: string): Promise<string> => (isFull ? Promise.resolve(resolveFull(pathRoot, p)) : real(root, p))

  const writeFile = tool(
    async ({ path: p, content }) => {
      try {
        const abs = await resolvePath(p)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, content, 'utf8')
        return `wrote ${p} (${content.length} bytes)`
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'write_file',
      description:
        'Create or overwrite a file. `path` is absolute relative to the project root (e.g. "/index.html"). Returns a confirmation.',
      schema: z.object({ path: z.string(), content: z.string() }),
    },
  )

  const readFile = tool(
    async ({ path: p }) => {
      // First, allow an absolute path that canonicalizes to within an enabled skill dir (read-only
      // bundled reference files live outside the project root). Anything else stays jailed to `root`.
      if (skillDirs.length > 0) {
        const inSkill = await realInSkill(skillDirs, p)
        if (inSkill) {
          try {
            return await fs.readFile(inSkill, 'utf8')
          } catch {
            return `Error: file not found: ${p}`
          }
        }
      }
      try {
        const abs = await resolvePath(p)
        return await fs.readFile(abs, 'utf8')
      } catch (err) {
        const msg = (err as Error).message
        if (msg.includes('escapes')) return `Error: ${msg}`
        return `Error: file not found: ${p}`
      }
    },
    {
      name: 'read_file',
      description:
        'Read a text file. `path` is absolute relative to the project root, OR an absolute path to a ' +
        'bundled file inside a loaded skill dir (as disclosed by use_skill).',
      schema: z.object({ path: z.string() }),
    },
  )

  const editFile = tool(
    async ({ path: p, oldString, newString, replaceAll }) => {
      try {
        const abs = await resolvePath(p)
        const cur = await fs.readFile(abs, 'utf8')
        if (!cur.includes(oldString)) return `Error: oldString not found in ${p}`
        const next = replaceAll ? cur.split(oldString).join(newString) : cur.replace(oldString, newString)
        await fs.writeFile(abs, next, 'utf8')
        return `edited ${p}`
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'edit_file',
      description: 'Replace an exact substring in a file. Set replaceAll to replace every occurrence.',
      schema: z.object({
        path: z.string(),
        oldString: z.string(),
        newString: z.string(),
        replaceAll: z.boolean().optional(),
      }),
    },
  )

  const ls = tool(
    async ({ path: p }) => {
      try {
        const abs = await resolvePath(p ?? '/')
        const ents = await fs.readdir(abs, { withFileTypes: true })
        return ents.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort().join('\n') || '(empty)'
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'ls',
      description: 'List the immediate children of a directory. `path` defaults to "/".',
      schema: z.object({ path: z.string().optional() }),
    },
  )

  const glob = tool(
    async ({ pattern }) => {
      let rx: RegExp
      try {
        rx = toGlobRegex(pattern)
      } catch (err) {
        return `Error: invalid pattern: ${(err as Error).message}`
      }
      const out: string[] = []
      // In 'full' (un-jailed) mode glob scans the un-jailed root (cwd) and reports paths relative to it,
      // matching ls/read_file/grep via resolvePath. Otherwise it stays jailed to `root`.
      const globBase = isFull ? pathRoot : root
      async function walk(dir: string): Promise<void> {
        if (out.length >= 200) return
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue
          if (EXCLUDE_DIRS.has(e.name)) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) await walk(full)
          else {
            const rel = '/' + path.relative(globBase, full)
            if (rx.test(rel)) out.push(rel)
          }
        }
      }
      await walk(globBase)
      return out.sort().slice(0, 200).join('\n') || `No files match ${pattern}`
    },
    {
      name: 'glob',
      description: 'Find files by a glob-ish pattern (supports * and **). Returns up to 200 paths.',
      schema: z.object({ pattern: z.string() }),
    },
  )

  const grep = tool(
    async ({ pattern, path: p }) => {
      let re: RegExp
      try {
        re = new RegExp(pattern)
      } catch (err) {
        return `Error: invalid regex: ${(err as Error).message}`
      }
      const hits: string[] = []
      async function walk(dir: string): Promise<void> {
        if (hits.length >= 200) return
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          if (hits.length >= 200) return
          if (e.name.startsWith('.')) continue
          if (EXCLUDE_DIRS.has(e.name)) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) {
            await walk(full)
          } else {
            const st = await fs.stat(full)
            if (st.size > MAX_SCAN_FILE_BYTES) continue
            const text = await fs.readFile(full, 'utf8').catch(() => '')
            if (text.slice(0, 8000).includes('\0')) continue
            text.split('\n').forEach((line, i) => {
              if (hits.length < 200 && re.test(line)) hits.push(`/${path.relative(root, full)}:${i + 1}: ${line.trim().slice(0, 200)}`)
            })
          }
        }
      }
      await walk(await resolvePath(p ?? '/'))
      return hits.slice(0, 200).join('\n') || `No matches for ${pattern}`
    },
    {
      name: 'grep',
      description: 'Search file contents by regex. Optional `path` scopes the search. Returns up to 200 `file:line` hits.',
      schema: z.object({ pattern: z.string(), path: z.string().optional() }),
    },
  )

  const writeTodos = tool(
    async ({ todos }) => {
      const done = todos.filter((t) => t.status === 'completed').length
      return `Updated todo list (${todos.length} item${todos.length === 1 ? '' : 's'}, ${done} done).`
    },
    {
      name: 'write_todos',
      description:
        'Publish or replace your plan for THIS turn as a checklist. Call it once at the start of a ' +
        'multi-step task and again whenever the plan changes — each call REPLACES the whole list. ' +
        '`todos` is an ordered array of { content, status } where status is "pending", "in_progress", ' +
        'or "completed". Keep at most one item "in_progress". Skip this for simple, single-step requests.',
      schema: z.object({
        todos: z.array(
          z.object({
            content: z.string(),
            status: z.enum(['pending', 'in_progress', 'completed']),
          }),
        ),
      }),
    },
  )

  // 'chat' = read-only: drop write_file/edit_file. (read_file/ls/glob/grep + write_todos stay.)
  const base: StructuredToolInterface[] = mode === 'chat'
    ? [readFile, ls, glob, grep, writeTodos]
    : [writeFile, readFile, editFile, ls, glob, grep, writeTodos]

  // Git tools are registered only for a real on-disk cwd (a git repo). They run against `cwd`
  // (the bound project root), NOT the file-tool sandbox `root` — same dir in practice, but explicit.
  if (cwd) {
    const gitCommitTool = tool(
      async ({ message }) => {
        const r = await gitCommit(cwd, message)
        return r.ok ? `committed ${(r.sha ?? '').slice(0, 7)}` : `Error: ${r.error ?? 'commit failed'}`
      },
      {
        name: 'git_commit',
        description:
          'Stage all changes and create a git commit with the given one-line `message`. Use ' +
          'proactively after completing a coherent unit of work (not per file). Returns "committed <sha>" ' +
          'or an error.',
        schema: z.object({ message: z.string() }),
      },
    )
    const gitCreateBranchTool = tool(
      async ({ branchName }) => {
        const r = await gitCreateBranch(cwd, branchName)
        return r.ok ? `created branch ${branchName}` : `Error: ${r.error ?? 'create branch failed'}`
      },
      {
        name: 'git_create_branch',
        description: 'Create a new git branch named `branchName` at the current HEAD (does not switch to it).',
        schema: z.object({ branchName: z.string() }),
      },
    )
    const gitSwitchBranchTool = tool(
      async ({ branchName }) => {
        const r = await gitSwitchBranch(cwd, branchName)
        return r.ok ? `switched to ${branchName}` : `Error: ${r.error ?? 'switch branch failed'}`
      },
      {
        name: 'git_switch_branch',
        description: 'Switch the checkout to an existing git branch named `branchName`.',
        schema: z.object({ branchName: z.string() }),
      },
    )
    const gitWorktreeCreateTool = tool(
      async ({ branch }) => {
        try {
          const worktreePath = path.join(getWorktreesDir(), branch)
          const r = await createWorktree(cwd, branch, worktreePath)
          return r.ok ? `Worktree created at ${r.path}` : `Error: ${r.error ?? 'create worktree failed'}`
        } catch (err) {
          return `Error: ${(err as Error).message}`
        }
      },
      {
        name: 'git_worktree_create',
        description:
          'Create a linked git worktree at the branch `branch` in the managed worktrees directory. ' +
          'The branch must already exist — create it first with git_create_branch if needed. ' +
          'Returns the path to the newly created worktree or an error.',
        schema: z.object({ branch: z.string() }),
      },
    )
    const gitWorktreeListTool = tool(
      async () => {
        try {
          const r = await listWorktrees(cwd)
          return r.ok ? JSON.stringify(r.worktrees) : `Error: ${r.error ?? 'list worktrees failed'}`
        } catch (err) {
          return `Error: ${(err as Error).message}`
        }
      },
      {
        name: 'git_worktree_list',
        description:
          'List all linked git worktrees for the current repository. ' +
          'Returns a JSON array of { path, branch, head } objects.',
        schema: z.object({}),
      },
    )
    const gitWorktreeRemoveTool = tool(
      async ({ worktreePath }) => {
        try {
          const r = await removeWorktree(cwd, worktreePath)
          return r.ok ? `Removed worktree at ${worktreePath}` : `Error: ${r.error ?? 'remove worktree failed'}`
        } catch (err) {
          return `Error: ${(err as Error).message}`
        }
      },
      {
        name: 'git_worktree_remove',
        description:
          'Remove a linked git worktree at `worktreePath`. The path must be inside the managed ' +
          'worktrees directory. Use git_worktree_list to see available worktrees.',
        schema: z.object({ worktreePath: z.string() }),
      },
    )
    base.push(gitCommitTool, gitCreateBranchTool, gitSwitchBranchTool, gitWorktreeCreateTool, gitWorktreeListTool, gitWorktreeRemoveTool)
  }

  // ── Skill / script / MCP extras (apply on hip's own loop, every assembly path) ──────────────
  const extras: StructuredToolInterface[] = []

  if (opts.skills && opts.skills.length > 0) {
    const skills = opts.skills
    const sessionId = opts.sessionId
    const useSkill = tool(
      async ({ name, arguments: args }) => {
        const s = skills.find((sk) => sk.name === name || sk.id === name)
        if (!s) return `Error: skill not found: ${name}`
        try {
          const rawBody = readSkillBody(s.dir)
          const substituted = substituteSkillBody(rawBody, args, s.arguments, s.dir, sessionId)
          const body = resolveDynamicContext(substituted, s.dir, {
            disabled: s.disableShellExecution,
          })
          const files = listSkillFiles(s.dir)
          const refFiles = files.filter((f) => f.startsWith('references/'))
          const assetFiles = files.filter((f) => f.startsWith('assets/'))
          const otherFiles = files.filter((f) => !f.startsWith('references/') && !f.startsWith('assets/'))
          const refNote = refFiles.length
            ? `\n- references/ (${refFiles.length} file${refFiles.length === 1 ? '' : 's'}): use read_file with the absolute paths below`
            : ''
          const assetNote = assetFiles.length
            ? `\n- assets/ (${assetFiles.length} file${assetFiles.length === 1 ? '' : 's'}): use read_file with the absolute paths below`
            : ''
          const manifestHeader = files.length
            ? `\n\n## Level 3 — Bundled resources (absolute paths)\n` +
              `Files shipped with this skill. These are NOT auto-read: call read_file with the ` +
              `absolute path for any file you need.${refNote}${assetNote}\n` +
              [...refFiles, ...assetFiles, ...otherFiles].map((f) => `- ${path.join(s.dir, f)}`).join('\n')
            : ''
          return `# Skill dir: ${s.dir}\n\n${body}${manifestHeader}`
        } catch (err) {
          return `Error: ${(err as Error).message}`
        }
      },
      {
        name: 'use_skill',
        description:
          'Load a skill into context by `name`. Skills use progressive disclosure: Level 1 (metadata in ' +
          'system prompt) shows name+description; Level 2 (full SKILL.md body, loaded by this tool) provides ' +
          'step-by-step instructions; Level 3 (bundled resources in references/ + assets/) are listed in the ' +
          'returned file manifest as absolute paths — read them with read_file. Call this when a task matches ' +
          'an advertised skill, then follow the loaded instructions. Pass `arguments` to substitute ' +
          '$ARGUMENTS, $0/$1, $name, and context variables.',
        schema: z.object({ name: z.string(), arguments: z.string().optional() }),
      },
    )
    extras.push(useSkill)
  }

  if (opts.webSearchEnabled) {
    const webSearch = tool(
      async ({ query }) => {
        try {
          const apiKey = process.env.HIP_WEBSEARCH_API_KEY
          if (!apiKey) return 'Error: web search API key not configured'
          const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
          const res = await globalThis.fetch(url, {
            headers: { 'X-Api-Key': apiKey },
          })
          if (!res.ok) return `Error: web search failed with status ${res.status}`
          const text = await res.text()
          return clipText(text, WEB_OUTPUT_CAP)
        } catch (err) {
          return `Error: web search failed: ${(err as Error).message}`
        }
      },
      {
        name: 'web_search',
        description:
          'Search the web for the given query and return results as text. ' +
          'Requires HIP_WEBSEARCH_API_KEY environment variable to be set.',
        schema: z.object({ query: z.string() }),
      },
    )

    const webFetch = tool(
      async ({ url }) => {
        try {
          const err = await validateFetchUrl(url)
          if (err) return err
          const res = await globalThis.fetch(url, {
            headers: { 'User-Agent': 'hip/0.1.0' },
            signal: AbortSignal.timeout(30_000),
          })
          if (!res.ok) return `Error: fetch failed with status ${res.status}`
          const text = await res.text()
          return clipText(text, WEB_OUTPUT_CAP)
        } catch (err) {
          const msg = (err as Error).message
          if (msg.includes('timeout') || (err as Error).name === 'TimeoutError') {
            return 'Error: fetch timed out after 30s'
          }
          return `Error: fetch failed: ${msg}`
        }
      },
      {
        name: 'web_fetch',
        description:
          'Fetch the content of a URL as text. Returns the response body clipped to 64KB. ' +
          'Useful for reading documentation, articles, or API responses. Has a 30-second timeout.',
        schema: z.object({ url: z.string() }),
      },
    )

    extras.push(webSearch, webFetch)
  }

  if (opts.generateAgentEnabled) {
    const generateAgent = tool(
      async ({ description, model }) => {
        try {
          const config = await generateAgentConfig(description, model)
          return JSON.stringify(config, null, 2)
        } catch (err) {
          return `Error: ${(err as Error).message}`
        }
      },
      {
        name: 'generate_agent',
        description:
          'Generate an AgentConfig from a natural-language description by calling generateAgentConfig. ' +
          'Returns the generated agent config as a JSON object with fields: id, name, description, ' +
          'kind, command, args, prompt, enabled, and optionally allowedSkills, allowedMcpServers, boundModel.',
        schema: z.object({
          description: z.string().describe('natural-language description of the agent role'),
          model: z.string().optional().describe('optional model ID to use for generation'),
        }),
      },
    )
    extras.push(generateAgent)
  }

  // run_script is dropped in chat (read-only) mode: a shell command would let a "read-only" agent
  // mutate the project, defeating the mode. Outside chat it is registered whenever an approval fn
  // is wired (every call is still HITL-gated).
  if (opts.requestApproval && mode !== 'chat') {
    const requestApproval = opts.requestApproval
    const scriptCwd = cwd ?? root
    const runScript = tool(
      async ({ command, reason }) => {
        const decision = await requestApproval({
          title: 'Run script',
          kind: 'execute',
          content: reason ? `${command}\n\n# ${reason}` : command,
        })
        if (!isApproved(decision)) return '用户拒绝执行该脚本（command was rejected by the user; nothing ran）。'
        const isWin = process.platform === 'win32'
        const shell = isWin ? 'cmd' : 'sh'
        const shellArgs = isWin ? ['/c', command] : ['-c', command]
        return await new Promise<string>((resolve) => {
          // Detached on non-Windows so the shell gets its own process group; killing -pid on timeout
          // reaps any grandchildren the script spawned (a bare child.kill leaves orphans).
          const child = spawn(shell, shellArgs, { cwd: scriptCwd, env: process.env, detached: !isWin })
          let out = ''
          let capped = false
          const onChunk = (b: Buffer) => {
            if (capped) return
            out += b.toString('utf8')
            if (out.length > SCRIPT_OUTPUT_CAP) { out = out.slice(0, SCRIPT_OUTPUT_CAP); capped = true }
          }
          child.stdout.on('data', onChunk)
          child.stderr.on('data', onChunk)
          let timedOut = false
          const timer = setTimeout(() => {
            timedOut = true
            if (!isWin && child.pid) {
              try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* already gone */ } }
            } else {
              try { child.kill('SIGKILL') } catch { /* already gone */ }
            }
          }, SCRIPT_TIMEOUT_MS)
          timer.unref?.()
          child.on('error', (err) => {
            clearTimeout(timer)
            resolve(`Error: failed to spawn shell: ${err.message}`)
          })
          child.on('close', (code) => {
            clearTimeout(timer)
            const tail = capped ? '\n…(output truncated to 64KB)' : ''
            const note = timedOut ? '\n(timed out after 120s; process killed)' : ''
            resolve(`exitCode: ${code ?? 'null'}${note}\n${out}${tail}`)
          })
        })
      },
      {
        name: 'run_script',
        description:
          'Run a shell command in the project directory. EVERY call is gated by an explicit user ' +
          'approval prompt — explain WHY in `reason`. Use for skill-bundled scripts and build/test ' +
          'commands. Returns the exit code and combined stdout/stderr (truncated to 64KB, 120s timeout). ' +
          'If the user rejects, the command does not run.',
        schema: z.object({ command: z.string(), reason: z.string().optional() }),
      },
    )
    extras.push(runScript)
  }

  if (opts.mcpTools && opts.mcpTools.length > 0) extras.push(...opts.mcpTools)

  if (!spawnSubagent) return [...base, ...extras]
  const task = tool(
    async ({ description, mode }) => spawnSubagent(description, mode),
    {
      name: 'task',
      description:
        'Delegate a focused, self-contained sub-task to a fresh sub-agent that runs its own loop ' +
        'with the file tools and returns a text result. Use to isolate research or a chunk of work. ' +
        'The sub-agent cannot itself delegate. Set mode to "background" to run the sub-agent ' +
        'without blocking the current turn (max 10 concurrent background tasks).',
      schema: z.object({
        description: z.string(),
        mode: z.enum(['foreground', 'background']).optional(),
      }),
    },
  )
  const out = [...base, task]

  if (!dispatch || dispatch.agents.length === 0) return [...out, ...extras]

  const roster = dispatch.agents
    .map((a) => `- ${a.id} (${a.name})${a.description ? `: ${a.description}` : ''}`)
    .join('\n')
  const ids = dispatch.agents.map((a) => a.id) as [string, ...string[]]
  const dispatchAgent = tool(
    async ({ agent, task: t }) => dispatch.run(agent, t),
    {
      name: 'dispatch_agent',
      description:
        'Delegate a focused, self-contained task to a specialized sub-agent and return its result. ' +
        'Pick the agent best matched to the task. Available agents:\n' +
        roster,
      schema: z.object({
        agent: z.enum(ids).describe('id of the sub-agent to delegate to'),
        task: z.string().describe('the complete, self-contained instruction for the sub-agent'),
      }),
    },
  )
  return [...out, dispatchAgent, ...extras]
}

/** Minimal glob: `**` matches any chars incl. `/`; `*` matches any chars except `/`. Anchored full-match. */
function toGlobRegex(pattern: string): RegExp {
  const rx = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, ' ')
    .replace(/\*/g, '[^/]*')
    .replace(/ /g, '.*')
  return new RegExp(`^${rx.startsWith('/') ? '' : '.*'}${rx}$`)
}
