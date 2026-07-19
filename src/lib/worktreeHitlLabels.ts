/**
 * Client-side i18n maps for worktree HITL options and catalog source subtitles (D18 / D19 / PR8).
 *
 * Sidecar `parallel_worktrees` still ships CN fallback `PermissionOption.name` strings;
 * PermissionModal rewrites display labels by optionId so EN/zh-TW locales stay correct.
 * Catalog `source` enums must not leak raw wire values into chrome once PR7 source wire is live.
 */

export const PARALLEL_WORKTREES_KIND = 'parallel_worktrees'

/** Known optionIds from packages/sidecar parallel_worktrees HITL. */
export const PARALLEL_HITL_OPTION_IDS = ['n1', 'n2', 'n3', 'n4', 'reject'] as const
export type ParallelHitlOptionId = (typeof PARALLEL_HITL_OPTION_IDS)[number]

/** Product-facing WorktreeSource values we humanize (see @hip/protocol WorktreeSource). */
export const WORKTREE_SOURCE_LABEL_IDS = [
  'protocol',
  'parallel',
  'host_fanout',
  'agent_tool',
  'background',
  'import',
  'discovered',
  'primary',
] as const
export type WorktreeSourceLabelId = (typeof WORKTREE_SOURCE_LABEL_IDS)[number]

export function isParallelHitlOptionId(id: string): id is ParallelHitlOptionId {
  return (PARALLEL_HITL_OPTION_IDS as readonly string[]).includes(id)
}

export function isWorktreeSourceLabelId(source: string): source is WorktreeSourceLabelId {
  return (WORKTREE_SOURCE_LABEL_IDS as readonly string[]).includes(source)
}

/**
 * Resolve display label for a permission option.
 * For parallel_worktrees + known optionId → i18n key via `t`.
 * Otherwise returns server-provided `name` unchanged.
 */
/** Loose i18n callable (compatible with i18next TFunction under strictFunctionTypes). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorktreeLabelTranslate = (key: any, opts?: any) => string

export function resolvePermissionOptionLabel(
  option: { optionId: string; name: string },
  toolKind: string,
  t: WorktreeLabelTranslate,
): string {
  if (toolKind === PARALLEL_WORKTREES_KIND && isParallelHitlOptionId(option.optionId)) {
    return t(`chat.worktreeControl.hitlOption.${option.optionId}`, {
      defaultValue: option.name,
    })
  }
  return option.name
}

/**
 * Humanized catalog source subtitle, or null when unknown / empty (never show raw enum).
 */
export function resolveWorktreeSourceLabel(
  source: string | undefined,
  t: WorktreeLabelTranslate,
): string | null {
  if (!source || !isWorktreeSourceLabelId(source)) return null
  const label = t(`chat.worktreeControl.source.${source}`, { defaultValue: '' })
  return label.trim() ? label : null
}
