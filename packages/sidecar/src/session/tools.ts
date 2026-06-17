import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { SkillMeta } from '@hip/protocol'
import { resolveWithin } from './workspace-fs.js'
import { gitCommit, gitCreateBranch, gitSwitchBranch } from './workspace-git.js'
import { readSkillBody, listSkillFiles } from './skills/registry.js'

const EXCLUDE_DIRS = new Set(['node_modules', '.git'])
const MAX_SCAN_FILE_BYTES = 256 * 1024
const SCRIPT_TIMEOUT_MS = 120_000
const SCRIPT_OUTPUT_CAP = 64 * 1024

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
  spawnSubagent?: (description: string) => Promise<string>,
  cwd?: string,
  dispatch?: DispatchSpec,
  opts: BuildToolsOpts = {},
): StructuredToolInterface[] {
  // Enabled-skill dirs (~/.hip/skills/<id>), DISJOINT from the project root. read_file may ALSO reach
  // bundled reference files under these (read-only); every other path stays jailed to `root` via real().
  const skillDirs = (opts.skills ?? []).map((s) => s.dir)

  const writeFile = tool(
    async ({ path: p, content }) => {
      try {
        const abs = await real(root, p)
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
        const abs = await real(root, p)
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
        const abs = await real(root, p)
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
        const abs = await real(root, p ?? '/')
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
      async function walk(dir: string): Promise<void> {
        if (out.length >= 200) return
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue
          if (EXCLUDE_DIRS.has(e.name)) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) await walk(full)
          else {
            const rel = '/' + path.relative(root, full)
            if (rx.test(rel)) out.push(rel)
          }
        }
      }
      await walk(root)
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
      await walk(await real(root, p ?? '/'))
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

  const base: StructuredToolInterface[] = [writeFile, readFile, editFile, ls, glob, grep, writeTodos]

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
    base.push(gitCommitTool, gitCreateBranchTool, gitSwitchBranchTool)
  }

  // ── Skill / script / MCP extras (apply on hip's own loop, every assembly path) ──────────────
  const extras: StructuredToolInterface[] = []

  if (opts.skills && opts.skills.length > 0) {
    const skills = opts.skills
    const useSkill = tool(
      async ({ name }) => {
        const s = skills.find((sk) => sk.name === name || sk.id === name)
        if (!s) return `Error: skill not found: ${name}`
        try {
          const body = readSkillBody(s.dir)
          const files = listSkillFiles(s.dir)
          const manifest = files.length
            ? `\n\n## Files in this skill (absolute paths — read bundled reference files with ` +
              `read_file using the absolute path; run bundled scripts with run_script using the absolute path):\n` +
              files.map((f) => `- ${path.join(s.dir, f)}`).join('\n')
            : ''
          return `# Skill dir: ${s.dir}\n\n${body}${manifest}`
        } catch (err) {
          return `Error: ${(err as Error).message}`
        }
      },
      {
        name: 'use_skill',
        description:
          'Load a skill into context by `name`. Returns the skill\'s full SKILL.md instructions, the ' +
          'absolute skill dir, plus a manifest of its bundled files as absolute paths. Call this when a ' +
          'task matches an advertised skill, then follow the loaded instructions: read bundled reference ' +
          'files with read_file using the absolute path, run bundled scripts with run_script using the ' +
          'absolute path.',
        schema: z.object({ name: z.string() }),
      },
    )
    extras.push(useSkill)
  }

  if (opts.requestApproval) {
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
    async ({ description }) => spawnSubagent(description),
    {
      name: 'task',
      description:
        'Delegate a focused, self-contained sub-task to a fresh sub-agent that runs its own loop ' +
        'with the file tools and returns a text result. Use to isolate research or a chunk of work. ' +
        'The sub-agent cannot itself delegate.',
      schema: z.object({ description: z.string() }),
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
