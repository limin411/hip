/** Built-in tools every internal agent always has. No per-tool gating remains; this list is for
 *  display / prompt-building only. (Permission-mode gating of write/edit/run_script happens in the
 *  sidecar per conversation, not per agent.) */
export const BUILTIN_TOOL_NAMES = [
  'read_file',
  'ls',
  'glob',
  'grep',
  'write_file',
  'edit_file',
  'write_todos',
  'git_commit',
  'git_create_branch',
  'git_switch_branch',
  'run_script',
  'use_skill',
] as const

/** Back-compat ONLY: parse a legacy `allowedTools` array and return the serverIds that were granted
 *  via `mcp__<id>__*` wildcards. Used once when seeding the editor / reading an old internal agent
 *  whose `allowedMcpServers` is still undefined. New configs use `allowedMcpServers` directly. */
export function grantedMcpServerIds(names: string[] | undefined): string[] {
  if (!names) return []
  const out: string[] = []
  for (const n of names) {
    const m = /^mcp__(.+)__\*$/.exec(n)
    if (m) out.push(m[1])
  }
  return out
}
