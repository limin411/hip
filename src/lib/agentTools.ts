/** Built-in tools an internal agent may be granted, grouped into capability buckets. */
export const TOOL_GROUPS = {
  read: ['read_file', 'ls', 'glob', 'grep'],
  edit: ['write_file', 'edit_file'],
  plan: ['write_todos'],
  git: ['git_commit', 'git_create_branch', 'git_switch_branch'],
  skill: ['use_skill'],
  script: ['run_script'],
} as const

export type ToolGroup = keyof typeof TOOL_GROUPS
export interface ToolGroups {
  read: boolean
  edit: boolean
  plan: boolean
  git: boolean
  skill: boolean
  script: boolean
}

/** A new internal agent: read + edit + plan; git / skill / script off. */
export const DEFAULT_TOOL_GROUPS: ToolGroups = { read: true, edit: true, plan: true, git: false, skill: false, script: false }

const ORDER: ToolGroup[] = ['read', 'edit', 'plan', 'git', 'skill', 'script']

/** Flatten the enabled groups to the precise tool-name allow-list (stable order). MCP-server grants
 *  are NOT static groups — the editor concatenates them as `mcp__<id>__*` wildcards separately. */
export function groupsToToolNames(g: ToolGroups): string[] {
  return ORDER.filter((k) => g[k]).flatMap((k) => [...TOOL_GROUPS[k]])
}

/** Derive group toggles from a stored allow-list. undefined ⇒ all on (legacy-safe); otherwise a
 *  group is on iff ANY of its tool names is present. MCP wildcard entries (`mcp__<id>__*`) belong to
 *  no static group, so `.some(includes)` correctly ignores them. */
export function toolNamesToGroups(names: string[] | undefined): ToolGroups {
  if (!names) return { read: true, edit: true, plan: true, git: true, skill: true, script: true }
  const has = (k: ToolGroup) => TOOL_GROUPS[k].some((n) => names.includes(n))
  return { read: has('read'), edit: has('edit'), plan: has('plan'), git: has('git'), skill: has('skill'), script: has('script') }
}

/** The allow-list entry that grants an internal agent every tool of one MCP server. The sidecar's
 *  filterTools expands this wildcard (frontend can't enumerate a server's tools without connecting). */
export function mcpServerWildcard(serverId: string): string {
  return `mcp__${serverId}__*`
}

/** Parse a stored allow-list and return the serverIds granted via `mcp__<id>__*` wildcards. */
export function grantedMcpServerIds(names: string[] | undefined): string[] {
  if (!names) return []
  const out: string[] = []
  for (const n of names) {
    const m = /^mcp__(.+)__\*$/.exec(n)
    if (m) out.push(m[1])
  }
  return out
}
