import type { AgentConfig } from '@hip/protocol'

/**
 * Three fixed, non-deletable internal agents.
 *
 * These are NOT stored in hip.toml's `agents` array. Their enable/disable
 * state is persisted under `[fixedAgents]` in hip.toml.
 *
 * Tool restrictions mirror the corresponding sidecar AgentProfile entries
 * (see packages/sidecar/src/session/agent-profile.ts).
 */
export const FIXED_AGENTS: AgentConfig[] = [
  {
    id: 'coder',
    name: 'Coder',
    description:
      '默认子 Agent，通用软件工程助手，可读写文件、执行命令、搜索代码并落地具体改动。',
    kind: 'internal',
    command: '',
    args: [],
    enabled: true,
    prompt: `You are a software engineering assistant. You can read and write files, execute shell commands, search code, and implement concrete changes. When given a task, break it down into steps and execute them methodically. Always verify your changes work correctly.`,
    allowedTools: [
      'read_file',
      'ls',
      'glob',
      'grep',
      'write_file',
      'edit_file',
      'run_script',
      'use_skill',
      'web_search',
      'web_fetch',
    ],
  },
  {
    id: 'explore',
    name: 'Explore',
    description:
      '代码库探索专用，只读操作，不修改文件。适合快速搜索、阅读和总结仓库。',
    kind: 'internal',
    command: '',
    args: [],
    enabled: true,
    prompt: `You are a codebase exploration agent. You can read files, search code, and summarize findings — but you CANNOT modify any files, execute shell commands, or make any changes to the codebase. Your purpose is to understand, search, and report. When asked about the codebase, be thorough in your exploration before answering.`,
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
    id: 'plan',
    name: 'Plan',
    description:
      '实现规划与架构设计专用，不提供 Shell 命令，专注于"想清楚怎么做"。',
    kind: 'internal',
    command: '',
    args: [],
    enabled: true,
    prompt: `You are a software architecture and planning agent. You focus on analyzing requirements, designing implementation approaches, and creating detailed plans. You do NOT have access to shell commands — your job is to think through the problem and produce a clear, actionable plan that others can execute. Consider trade-offs, edge cases, and existing codebase patterns in your analysis.`,
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
]

export const FIXED_AGENT_IDS = FIXED_AGENTS.map((a) => a.id)
