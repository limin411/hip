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

export const ALL_BUILTIN_TOOLS: string[] = [
  'write_file',
  'read_file',
  'edit_file',
  'ls',
  'glob',
  'grep',
  'write_todos',
  'git_commit',
  'git_create_branch',
  'git_switch_branch',
  'git_worktree_create',
  'git_worktree_list',
  'git_worktree_remove',
  'use_skill',
  'web_search',
  'web_fetch',
  'generate_agent',
  'run_script',
  'task',
  'dispatch_agent',
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
    allowedTools: [
      'read_file',
      'ls',
      'glob',
      'grep',
      'use_skill',
      'web_search',
      'web_fetch',
    ],
  },
  {
    id: 'worker',
    name: 'Worker',
    description:
      'Subagent for focused implementation tasks: reads, writes, and edits files. Explicitly blocked from write_todos so planning stays with the primary agent.',
    mode: 'subagent',
    allowedTools: [
      'read_file',
      'ls',
      'glob',
      'grep',
      'write_file',
      'edit_file',
      'use_skill',
      'web_search',
      'web_fetch',
    ],
    blockedTools: ['write_todos'],
  },
]
