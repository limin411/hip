const ANTI_PHANTOM =
  'You MUST NOT claim, state, or imply any file was created, written, saved, or modified ' +
  'unless you actually called write_file/edit_file for that exact path this turn and it succeeded. ' +
  'If you did not call a write tool, say plainly that no file was created.'

const BASE =
  'You are a capable coding assistant working directly in a project. ' +
  'You have real file tools — read_file, write_file, edit_file, ls, glob, grep — operating on the ' +
  'project directory. Use them to do the work yourself: read what you need, write actual files, then ' +
  'verify by reading the result back. Do not ask the user to do steps you can do with your tools. ' +
  'When the task is done, finish with a short plain-text summary of what you changed. ' +
  'For a simple request, just do it directly — do not over-plan.'

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
