import { FIXED_AGENT_IDS } from '@hip/protocol'

/**
 * AgentProfile — typed agent configuration that gates tool access per role.
 *
 * Supervisor has full tool access (all built-in tools). Plan and Explore are
 * read-only + search profiles. Worker is a subagent with write access but
 * without write_todos (planning stays with the primary profiles).
 */

export interface AgentProfile {
  id: string
  name: string
  description?: string
  mode: 'primary' | 'subagent'
  allowedTools?: string[]
  blockedTools?: string[]
  modelBinding?: { providerID: string; modelID: string }
  systemPrompt?: string
  maxSteps?: number
  temperature?: number
}

/**
 * IDs of the fixed (non-deletable) built-in agent profiles whose enable/disable
 * state is controlled by the `[fixedAgents]` section in hip.toml.
 */
export { FIXED_AGENT_IDS }

const SUBAGENT_BASE_TOOLS: string[] = [
  'read_file',
  'ls',
  'glob',
  'grep',
  'write_file',
  'edit_file',
  'use_skill',
  'web_search',
  'web_fetch',
]

/** Read-only tools for explore (primary profile + managed dispatch agent). */
export const EXPLORE_ALLOWED_TOOLS: string[] = [
  'read_file',
  'ls',
  'glob',
  'grep',
  'use_skill',
  'web_search',
  'web_fetch',
]

export const ALL_BUILTIN_TOOLS: string[] = [
  'write_file',
  'read_file',
  'edit_file',
  'ls',
  'glob',
  'grep',
  'write_todos',
  'EnterPlanMode',
  'ExitPlanMode',
  'git_commit',
  'git_create_branch',
  'git_switch_branch',
  'use_skill',
  'web_search',
  'web_fetch',
  'generate_agent',
  'run_script',
  'task',
  'dispatch_agent',
  'task_batch',
  'task_retry',
  'task_stop',
  'task_output',
  'goal_create',
  'goal_status',
  'goal_update',
]

export const BUILTIN_PROFILES: AgentProfile[] = [
  {
    id: 'supervisor',
    name: 'Supervisor',
    description:
      'Orchestrates multi-step work: plans, delegates to sub-agents, commits code, and runs scripts. Has access to all built-in tools.',
    mode: 'primary',
    allowedTools: ALL_BUILTIN_TOOLS,
  },
  {
    id: 'plan',
    name: 'Plan',
    description:
      'Read-only profile for investigation, research, and writing plans. Cannot write files, edit, commit, or run scripts.',
    mode: 'primary',
    allowedTools: [
      'read_file',
      'ls',
      'glob',
      'grep',
      'write_todos',
      'EnterPlanMode',
      'ExitPlanMode',
      'use_skill',
      'web_search',
      'web_fetch',
    ],
  },
  {
    id: 'explore',
    name: 'Explore',
    description:
      'Read-only profile for codebase exploration and research. Cannot write todos or modify anything.',
    mode: 'primary',
    allowedTools: [...EXPLORE_ALLOWED_TOOLS],
  },
  {
    // LEGACY: prefer `coder` / `explore` / `plan` for new delegation (Sprint C naming).
    // Kept so existing configs and tests that reference `worker` keep working.
    id: 'worker',
    name: 'Worker',
    description:
      'Legacy generic subagent (prefer coder/explore/plan). Reads, writes, and edits files. Explicitly blocked from write_todos so planning stays with the primary agent.',
    mode: 'subagent',
    allowedTools: SUBAGENT_BASE_TOOLS,
    blockedTools: ['write_todos'],
  },
  {
    id: 'coder',
    name: 'Coder',
    description:
      'General software engineering sub-agent. Reads, writes, edits files, runs scripts, and searches code. Blocked from write_todos so planning stays with the primary agent.',
    mode: 'subagent',
    allowedTools: [...SUBAGENT_BASE_TOOLS, 'run_script'],
    blockedTools: ['write_todos'],
  },
]
