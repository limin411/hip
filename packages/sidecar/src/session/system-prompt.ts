const ANTI_PHANTOM =
  'You MUST NOT claim, state, or imply any file was created, written, saved, or modified ' +
  'unless you actually called write_file/edit_file for that exact path this turn and it succeeded. ' +
  'If you did not call a write tool, say plainly that no file was created.'

const BASE =
  'You are a capable coding assistant working directly in a project. ' +
  'You have real file tools — read_file, write_file, edit_file, ls, glob, grep — and a planning tool, ' +
  'write_todos — operating on the ' +
  'project directory. Use them to do the work yourself: read what you need, write actual files, then ' +
  'verify by reading the result back. Do not ask the user to do steps you can do with your tools. ' +
  'When the task is done, finish with a short plain-text summary of what you changed. ' +
  'For a multi-step task, call write_todos first to lay out an ordered checklist, then update it as ' +
  'you go — mark exactly one item in_progress at a time and flip items to completed as you finish them. ' +
  'For a simple, single-step request, just do it directly — do not over-plan or call write_todos.'

function cwdBlock(cwd: string): string {
  return (
    `Your working directory is the project root \`${cwd}\`. Filesystem tools are sandboxed to it. ` +
    'Address every path as an absolute path starting with `/`, relative to this root — ' +
    `e.g. write to \`/index.html\` (maps to \`${cwd}/index.html\`). ` +
    'Never use `/workspace`, `/tmp`, `/home`, or any path outside this root.'
  )
}

export interface SystemPromptInput {
  cwd: string
  userInstructions?: string
}

/** Assemble the single-agent system prompt: base + cwd convention + anti-phantom (+ optional user instructions). */
export function buildSystemPrompt({ cwd, userInstructions }: SystemPromptInput): string {
  const base = `${BASE}\n\n${cwdBlock(cwd)}\n\n${ANTI_PHANTOM}`
  const extra = userInstructions?.trim()
  return extra
    ? `${base}\n\n## Additional instructions from the user (for this conversation)\n${extra}`
    : base
}

const CHILD_BASE =
  'You are a focused sub-agent completing a single delegated sub-task. ' +
  'You have real file tools — read_file, write_file, edit_file, ls, glob, grep — operating on the ' +
  'project directory. Do the work yourself: read what you need, write actual files, then verify by ' +
  'reading the result back. You cannot delegate further. When done, return a concise text result ' +
  'describing what you found or changed.'

/** System prompt for a delegated sub-agent: base tools + cwd convention + anti-phantom, framed
 *  around a single sub-task. No planning/delegation guidance (the child has no task tool). */
export function childSystemPrompt(description: string, cwd: string): string {
  return `${CHILD_BASE}\n\n${cwdBlock(cwd)}\n\n${ANTI_PHANTOM}\n\n## Your delegated sub-task\n${description}`
}
