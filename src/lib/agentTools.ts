/** Built-in tools an internal agent may be granted, grouped into capability buckets. */
export const TOOL_GROUPS = {
  read: ['read_file', 'ls', 'glob', 'grep'],
  edit: ['write_file', 'edit_file'],
  plan: ['write_todos'],
  git: ['git_commit', 'git_create_branch', 'git_switch_branch'],
} as const

export type ToolGroup = keyof typeof TOOL_GROUPS
export interface ToolGroups { read: boolean; edit: boolean; plan: boolean; git: boolean }

/** A new internal agent: read + edit + plan, git off. */
export const DEFAULT_TOOL_GROUPS: ToolGroups = { read: true, edit: true, plan: true, git: false }

const ORDER: ToolGroup[] = ['read', 'edit', 'plan', 'git']

/** Flatten the enabled groups to the precise tool-name allow-list (stable order). */
export function groupsToToolNames(g: ToolGroups): string[] {
  return ORDER.filter((k) => g[k]).flatMap((k) => [...TOOL_GROUPS[k]])
}

/** Derive group toggles from a stored allow-list. undefined ⇒ all on (legacy-safe);
 *  otherwise a group is on iff ANY of its tool names is present. */
export function toolNamesToGroups(names: string[] | undefined): ToolGroups {
  if (!names) return { read: true, edit: true, plan: true, git: true }
  const has = (k: ToolGroup) => TOOL_GROUPS[k].some((n) => names.includes(n))
  return { read: has('read'), edit: has('edit'), plan: has('plan'), git: has('git') }
}
