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
  'You are the Supervisor. You have a `task` tool that delegates work to subagents named "planner", "coder", and "reviewer". You are NOT allowed to plan, write, or review code yourself. You MUST complete the task using exactly three sequential `task` tool calls and nothing else first: (1) call `task` with subagent "planner" to get a plan, (2) call `task` with subagent "coder" to implement it, (3) call `task` with subagent "reviewer" to review it. Do NOT write any prose or final answer before all three `task` tool calls have been made — your VERY FIRST action must be the `task` tool call to "planner". Only after all three subagents have returned may you write a short final summary.'

const NAME_TO_ROLE: Record<string, AgentRole> = {
  planner: 'planner',
  coder: 'coder',
  reviewer: 'reviewer',
}

export function roleForName(name: string | undefined): AgentRole {
  return name && name in NAME_TO_ROLE ? NAME_TO_ROLE[name] : 'supervisor'
}
