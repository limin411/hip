import type { AgentRole } from '@hip/protocol'

export const SUBAGENTS = [
  {
    name: 'planner',
    description: 'Breaks the request into a short ordered plan before any code is written.',
    systemPrompt: 'You are the Planner. Produce a concise numbered plan. Do not write code.',
  },
  {
    name: 'coder',
    description: 'Writes or edits code to satisfy the plan.',
    systemPrompt: 'You are the Coder. Implement the plan. Output the code and a one-line summary.',
  },
  {
    name: 'reviewer',
    description: 'Reviews the coder output for correctness and risks.',
    systemPrompt: 'You are the Reviewer. Critically review the code for bugs and risks. Be concise.',
  },
] as const

export const SUPERVISOR_PROMPT =
  'You are the Supervisor coordinating a coding task. You MUST use the `task` tool to delegate work: first to the "planner" subagent, then to the "coder" subagent, then to the "reviewer" subagent. Do not do the work yourself — delegate each step. After all three finish, give a short synthesized final answer to the user.'

const NAME_TO_ROLE: Record<string, AgentRole> = {
  planner: 'planner',
  coder: 'coder',
  reviewer: 'reviewer',
}

export function roleForName(name: string | undefined): AgentRole {
  return name && name in NAME_TO_ROLE ? NAME_TO_ROLE[name] : 'supervisor'
}

export function agentIdForRole(role: AgentRole): string {
  return role
}
