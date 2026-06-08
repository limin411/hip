import type { AgentRole } from '@hip/protocol'

export interface SubagentSpec {
  name: string
  description: string
  systemPrompt: string
}

function cwdBlock(cwd: string): string {
  return (
    `Your working directory is the project root \`${cwd}\`. Filesystem tools are sandboxed to it. ` +
    'Address every path as an absolute path starting with `/`, relative to this root — ' +
    `e.g. write to \`/self-intro.html\` (maps to \`${cwd}/self-intro.html\`). ` +
    'Never use `/workspace`, `/tmp`, `/home`, or any path outside this root.'
  )
}

const ANTI_PHANTOM =
  'You MUST NOT claim, state, or imply any file was created, written, saved, or modified ' +
  'unless you actually called write_file/edit_file for that exact path this turn and it succeeded. ' +
  'If you did not call a write tool, say plainly that no file was created.'

// Verbatim copy of the original supervisor prompt (live-tested delegation wording — do not paraphrase)
const SUPERVISOR_BASE =
  'You are the Supervisor. You have a `task` tool that delegates work to subagents named "planner", "coder", and "reviewer". You are NOT allowed to plan, write, or review code yourself. You MUST complete the task using exactly three sequential `task` tool calls and nothing else first: (1) call `task` with subagent "planner" to get a plan, (2) call `task` with subagent "coder" to implement it, (3) call `task` with subagent "reviewer" to review it. Do NOT write any prose or final answer before all three `task` tool calls have been made — your VERY FIRST action must be the `task` tool call to "planner". Only after all three subagents have returned may you write a short final summary.'

// Verbatim copy of the original coder subagent systemPrompt (live-tested — do not paraphrase)
const CODER_BASE =
  'You are the Coder. Implement the plan. You have real file tools — read_file, write_file, edit_file, ls, glob, grep — operating on the project directory; use them to read and write actual files. All paths are relative to the project root (e.g. "/src/index.ts"). Output the code and a one-line summary.'

export function buildSupervisorPrompt(cwd: string): string {
  return (
    `${SUPERVISOR_BASE}\n\n${cwdBlock(cwd)}\n\n${ANTI_PHANTOM}\n\n` +
    'In your final summary, only report files the coder actually wrote via tool calls.'
  )
}

export function buildSubagents(cwd: string): SubagentSpec[] {
  return [
    {
      name: 'planner',
      description: 'Breaks the request into a short ordered plan before any code is written.',
      systemPrompt: 'You are the Planner. Produce a concise numbered plan. Do not write code.',
    },
    {
      name: 'coder',
      description: 'Writes or edits code to satisfy the plan.',
      systemPrompt: `${CODER_BASE}\n\n${cwdBlock(cwd)}\n\n${ANTI_PHANTOM}`,
    },
    {
      name: 'reviewer',
      description: 'Reviews the coder output for correctness and risks.',
      systemPrompt: 'You are the Reviewer. Critically review the code for bugs and risks. Be concise.',
    },
  ]
}

const NAME_TO_ROLE: Record<string, AgentRole> = { planner: 'planner', coder: 'coder', reviewer: 'reviewer' }

export function roleForName(name: string | undefined): AgentRole {
  return name && name in NAME_TO_ROLE ? NAME_TO_ROLE[name] : 'supervisor'
}
