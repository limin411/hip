import { globSync } from 'node:fs'
import type { SkillMeta, PermissionMode } from '@hip/protocol'
import { PRODUCT_HELP_GUIDANCE } from './product/builtin-skills.js'

// ── Skill budget & LRU eviction ─────────────────────────────────────────

/** Tracks skill invocation counts per session. Used by LRU eviction to determine
 *  which skills are least-used when the skill block exceeds the context budget. */
export class SkillUsageTracker {
  private counts = new Map<string, number>()

  /** Record that a skill was invoked (called whenever use_skill succeeds). */
  recordInvocation(skillId: string): void {
    this.counts.set(skillId, (this.counts.get(skillId) ?? 0) + 1)
  }

  /** Get the invocation count for a skill (0 if never used). */
  getCount(skillId: string): number {
    return this.counts.get(skillId) ?? 0
  }

  /** Snapshot of all tracked counts (for debugging). */
  snapshot(): ReadonlyMap<string, number> {
    return new Map(this.counts)
  }
}

/** Budget for the "## Skills" block in the system prompt.
 *  @param contextWindowTokens The model's context window size in tokens (e.g. 128000 for 128k).
 *    When not provided, defaults to 128000 (a typical modern model).
 *  @returns Character budget capped at 2000 — 1% of the token window, assuming ~4 chars/token. */
export function getSkillsBudget(contextWindowTokens?: number): number {
  const tokens = contextWindowTokens ?? 128_000
  const charBudget = Math.floor(tokens * 0.01 * 4)
  return Math.min(charBudget, 2000)
}

const ANTI_PHANTOM =
  'You MUST NOT claim, state, or imply any file was created, written, saved, or modified ' +
  'unless you actually called write_file/edit_file for that exact path this turn and it succeeded. ' +
  'If you did not call a write tool, say plainly that no file was created.'

const GIT_GUIDANCE =
  'When the project is a git repository you also have git tools — git_commit, git_create_branch, ' +
  'git_switch_branch. Commit proactively after a coherent unit of work with a concise one-line ' +
  'message (under 72 characters, imperative mood). Group related edits into a single commit — do not ' +
  'commit after every individual file write. Use git_create_branch / git_switch_branch only when the ' +
  'work warrants a separate line of history (e.g. an experimental or large refactor). These tools ' +
  'commit on the user\'s behalf, so keep messages clear and the history clean.'

const IDENTITY =
  'You are hip, a desktop AI workbench agent that works directly in the user\'s project. ' +
  'When asked who or what you are, identify yourself as hip. ' +
  'Never claim or imply that you are Claude, ChatGPT, Gemini, or any other named assistant, ' +
  'and do not name the underlying model or its maker.'

const BASE =
  'You are a capable coding assistant working directly in a project. ' +
  'You have real file tools — read_file, write_file, edit_file, ls, glob, grep — and a planning tool, ' +
  'write_todos — operating on the ' +
  'project directory. Use them to do the work yourself: read what you need, write actual files, then ' +
  'verify by reading the result back. Do not ask the user to do steps you can do with your tools. ' +
  'When the task is done, finish with a short plain-text summary of what you changed. ' +
  'Prefer edit_file for localized changes (font sizes, box dimensions, labels, small SVG/HTML/CSS fixes). ' +
  'Avoid a single write_file that rewrites multi-thousand-line files — large one-shot rewrites can stall; ' +
  'edit in sections with edit_file, or rewrite only when creating a new file or a true full replacement is required. ' +
  'When read_file output is truncated, re-read missing ranges with offset/limit before editing — do not invent ' +
  'the rest of the file from a partial read. ' +
  'For a multi-step task, call write_todos first to lay out an ordered checklist, then update it as ' +
  'you go — mark exactly one item in_progress at a time and flip items to completed as you finish them. ' +
  'For a large, self-contained chunk of work or isolated research, you may call task, dispatch_agent, or ' +
  'task_batch to delegate to a focused sub-agent that runs its own loop with the file tools and returns a result. ' +
  'Prefer specialized agents when available: explore for read-only codebase search, plan for design-only ' +
  'planning, coder for implementation with scripts. ' +
  'CRITICAL — parallel fan-out: when the user asks for parallel work or you have 2+ independent sub-tasks ' +
  '(e.g. check several modules at once), you MUST use a single task_batch call with one entry per sub-task. ' +
  'Set each task\'s optional agent field to a specialized roster id (e.g. explore) when dispatch_agent is available. ' +
  'task_batch runs those sub-agents concurrently. Do NOT issue multiple sequential dispatch_agent or foreground ' +
  'task calls for independent work — that is serial and slow. dispatch_agent alone is blocking (one agent at a ' +
  'time) unless the model emits several dispatch_agent calls in the same tool-call batch (then they may run in ' +
  'parallel). Never claim work ran "in parallel" if you only used sequential dispatch_agent/task. ' +
  'For fire-and-forget only, use task with mode background, then task_output/task_stop as needed. ' +
  'When a task, dispatch_agent, or task_batch result returns, treat it as the research source of truth: do not ' +
  're-run the same ls/glob/grep/read_file exploration the sub-agent already did unless the result is empty, ' +
  'errored, clearly incomplete, or you need a specific file section the summary omitted. ' +
  'For a simple, single-step request (greetings, list a directory, read one file, answer a short question), ' +
  'do it yourself with tools and answer directly — do not call task, task_batch, write_todos, or spawn sub-agents. ' +
  'Never thrash on .git/objects or invent shell tool names; use run_script for shell, and stop probing ' +
  'when a tool fails or returns binary/unreadable content — summarize what you know instead.'

function cwdBlock(cwd: string, permissionMode?: PermissionMode): string {
  if (permissionMode === 'full') {
    return (
      `Your working directory is the project root \`${cwd}\`. Filesystem tools are NOT sandboxed: you ` +
      'may read and write any directory on this machine. Prefer absolute paths; a relative or ' +
      `\`/\`-rooted path resolves against \`${cwd}\`. The user has explicitly granted full filesystem access.`
    )
  }
  if (permissionMode === 'chat') {
    return (
      `Your working directory is the project root \`${cwd}\`. You are in READ-ONLY mode: you cannot write ` +
      'or edit files and cannot run scripts (those tools are not available). Use read_file, ls, glob, and ' +
      'grep to inspect the project. Address every path as an absolute path starting with `/`, relative to ' +
      `this root — e.g. \`/index.html\` (maps to \`${cwd}/index.html\`). Never use a path outside this root.`
    )
  }
  return (
    `Your working directory is the project root \`${cwd}\`. Filesystem tools are sandboxed to it. ` +
    'Address every path as an absolute path starting with `/`, relative to this root — ' +
    `e.g. write to \`/index.html\` (maps to \`${cwd}/index.html\`). ` +
    'Never use `/workspace`, `/tmp`, `/home`, or any path outside this root.'
  )
}

/** Options for the skills block builder. */
export interface SkillsBlockOptions {
  /** Max character budget for the entire "## Skills" block (default: no limit). */
  budget?: number
  /** Tracker to determine which skills are least-used for LRU eviction. */
  tracker?: SkillUsageTracker
}

/** A short "## Skills" block listing auto-invoke-eligible skills with descriptions,
 *  instructing the model to call use_skill when a task matches. Skills where
 *  autoInvoke === false are omitted. Skills with a `paths` glob are only included
 *  when the cwd contains at least one file matching a pattern.
 *
 *  When `budget` is set, the block is trimmed to fit: descriptions are truncated
 *  (min 50 chars each), then least-invoked skills are LRU-evicted until the block
 *  fits. A warning is logged when skills are evicted. */
export function skillsBlock(skills: SkillMeta[], cwd?: string, opts?: SkillsBlockOptions): string {
  const eligible = skills.filter((s) => s.autoInvoke !== false)

  const filtered = eligible.filter((s) => {
    if (!s.paths || s.paths.length === 0) return true
    if (!cwd) return false
    try {
      const matches = globSync(s.paths, { cwd })
      return matches.length > 0
    } catch {
      return false
    }
  })

  if (filtered.length === 0) return ''

  const scopeTag = (s: SkillMeta) => (s.scope === 'project' ? ' (project)' : s.scope === 'plugin' ? ' (plugin)' : '')

  const header =
    '## Skills\n' +
    'When a user\'s task matches a skill\'s description, call use_skill({ name }) to load its full instructions. ' +
    'Only use skills listed below.\n'

  if (!opts?.budget || opts.budget <= 0) {
    const lines = filtered.map((s) => `- ${s.name}${scopeTag(s)}: ${s.description}`).join('\n')
    return header + lines
  }

  // Budget-aware mode: build lines, truncate descriptions, then LRU-evict
  const budget = opts.budget
  const tracker = opts.tracker

  // Phase 1: Truncate descriptions to save space (min 50 chars)
  const makeLine = (s: SkillMeta): string => {
    const desc = s.description.length > 100 ? s.description.slice(0, 97) + '...' : s.description
    return `- ${s.name}${scopeTag(s)}: ${desc}`
  }

  let linesWithMeta = filtered.map((s) => ({ skill: s, line: makeLine(s) }))

  // Phase 2: If still over budget, further truncate descriptions (min 50 chars)
  const MIN_DESC = 50
  const tightenLine = (s: SkillMeta): string => {
    const desc = s.description.slice(0, MIN_DESC) + (s.description.length > MIN_DESC ? '...' : '')
    return `- ${s.name}${scopeTag(s)}: ${desc}`
  }

  let currentBlock = header + linesWithMeta.map((l) => l.line).join('\n')
  if (currentBlock.length > budget) {
    linesWithMeta = linesWithMeta.map((l) => ({ ...l, line: tightenLine(l.skill) }))
    currentBlock = header + linesWithMeta.map((l) => l.line).join('\n')
  }

  // Phase 3: LRU-evict least-used skills until block fits
  const evicted: string[] = []
  if (currentBlock.length > budget) {
    // Sort: least-invoked first (tie-break: alphabetically for determinism)
    linesWithMeta.sort((a, b) => {
      const countA = tracker?.getCount(a.skill.id) ?? 0
      const countB = tracker?.getCount(b.skill.id) ?? 0
      if (countA !== countB) return countA - countB
      return a.skill.id.localeCompare(b.skill.id)
    })

    while (currentBlock.length > budget && linesWithMeta.length > 0) {
      const evictedMeta = linesWithMeta.shift()!
      evicted.push(evictedMeta.skill.id)
      currentBlock = header + linesWithMeta.map((l) => l.line).join('\n')
    }

    if (evicted.length > 0) {
      console.warn(
        `[system-prompt] Skills block exceeded budget (${budget} chars). ` +
        `Evicted ${evicted.length} least-used skill(s): ${evicted.join(', ')}`
      )
    }
  }

  if (linesWithMeta.length === 0) return ''
  return header + linesWithMeta.map((l) => l.line).join('\n')
}

export interface SystemPromptInput {
  cwd: string
  userInstructions?: string
  skills?: SkillMeta[]
  permissionMode?: PermissionMode
  mcpCatalog?: string
  /** Chat surface omits long git guidance to save tokens (Sprint B). */
  surface?: 'chat' | 'code'
}

const BASE_CHAT =
  'You are a helpful desktop assistant. Prefer short answers. ' +
  'You have a private sandbox workspace with file tools (when available). ' +
  'For simple greetings or short questions, answer directly without tools or sub-agents. ' +
  'When the user asks for a previewable deliverable — HTML page, image, PDF, Markdown doc, or similar — ' +
  'write it with write_file to a root-relative path (e.g. `/page.html`, `/notes.md`, `/chart.svg`) so it ' +
  'appears in the artifacts preview. Do not only paste large HTML/source into the chat. ' +
  'Do not invent shell tool names; use run_script only if it is available.'

/** Assemble the single-agent system prompt: base + cwd convention + anti-phantom (+ optional skills, user instructions, MCP catalog). */
export function buildSystemPrompt({ cwd, userInstructions, skills, permissionMode, mcpCatalog, surface }: SystemPromptInput): string {
  const isChat = surface === 'chat' || permissionMode === 'chat'
  const body = isChat ? BASE_CHAT : BASE
  // Identity + compact product pointer (Hermes-style). Full product depth is progressive via use_skill("hip").
  let base = isChat
    ? `${IDENTITY}\n\n${PRODUCT_HELP_GUIDANCE}\n\n${body}\n\n${cwdBlock(cwd, permissionMode)}\n\n${ANTI_PHANTOM}`
    : `${IDENTITY}\n\n${PRODUCT_HELP_GUIDANCE}\n\n${body}\n\n${cwdBlock(cwd, permissionMode)}\n\n${GIT_GUIDANCE}\n\n${ANTI_PHANTOM}`
  if (skills && skills.length > 0) {
    // Tighter skill budget on chat to save context (Sprint B).
    const block = skillsBlock(skills, cwd, isChat ? { budget: 1500 } : undefined)
    if (block) base = `${base}\n\n${block}`
  }
  if (mcpCatalog && !isChat) {
    base = `${base}\n\n## MCP Tools\n${mcpCatalog}\nUse \`mcp_search\` to find tools by keyword, then call them by their namespaced name (\`mcp__<server>__<tool>\`).`
  }
  const extra = userInstructions?.trim()
  return extra
    ? `${base}\n\n## Additional instructions from the user (for this conversation)\n${extra}`
    : base
}

const CHILD_BASE =
  'Right now you are acting as a focused sub-agent completing a single delegated sub-task. ' +
  'You have real file tools — read_file, write_file, edit_file, ls, glob, grep — operating on the ' +
  'project directory. Do the work yourself: read what you need, write actual files, then verify by ' +
  'reading the result back. Prefer edit_file for localized fixes; avoid one-shot multi-thousand-line write_file. ' +
  'You cannot delegate further. When done, return a concise text result ' +
  'describing what you found or changed.'

/** System prompt for a delegated sub-agent: identity + base tools + cwd convention + anti-phantom,
 *  framed around a single sub-task. No planning/delegation guidance (the child has no task tool).
 *  `permissionMode` cascades from the parent turn so the cwd block matches the worker's actual toolset
 *  (chat = read-only, full = un-sandboxed), mirroring buildSystemPrompt/buildManagedAgentPrompt. */
export function childSystemPrompt(description: string, cwd: string, permissionMode?: PermissionMode): string {
  return `${IDENTITY}\n\n${CHILD_BASE}\n\n${cwdBlock(cwd, permissionMode)}\n\n${ANTI_PHANTOM}\n\n## Your delegated sub-task\n${description}`
}

export interface ManagedAgentPromptInput {
  cwd: string
  persona: string
  toolNames: string[]
  skills?: SkillMeta[]
  permissionMode?: PermissionMode
  mcpCatalog?: string
}

/** System prompt for an internal managed sub-agent: identity guard + an operating preamble that
 *  enumerates the agent's ACTUAL granted tools + cwd convention + anti-phantom + the persona, framed
 *  as a focused, non-delegating sub-agent. Git guidance only when a git tool is granted; skills block
 *  only when use_skill is granted AND skills are supplied. MCP catalog when mcp_search is available. */
export function buildManagedAgentPrompt({ cwd, persona, toolNames, skills, permissionMode, mcpCatalog }: ManagedAgentPromptInput): string {
  const toolList = toolNames.length ? toolNames.join(', ') : '(no tools — answer from reasoning only)'
  const base =
    'Right now you are acting as a focused sub-agent completing a single delegated sub-task. ' +
    `Your available tools are: ${toolList}. ` +
    'Use them to do the work yourself — read what you need, make changes only with the tools you have, ' +
    'and verify your results. You cannot delegate further. When done, return a concise text result ' +
    'describing what you found or changed.'
  const hasGit = toolNames.some((n) => n.startsWith('git_'))
  const parts = [IDENTITY, base, cwdBlock(cwd, permissionMode)]
  if (hasGit) parts.push(GIT_GUIDANCE)
  if (toolNames.includes('use_skill') && skills && skills.length > 0) {
    const block = skillsBlock(skills, cwd)
    if (block) parts.push(block)
  }
  if (mcpCatalog && toolNames.includes('mcp_search')) {
    parts.push(`## MCP Tools\n${mcpCatalog}\nUse \`mcp_search\` to find tools by keyword, then call them by their namespaced name (\`mcp__<server>__<tool>\`).`)
  }
  parts.push(ANTI_PHANTOM, `## Your role and instructions\n${persona.trim()}`)
  return parts.join('\n\n')
}
