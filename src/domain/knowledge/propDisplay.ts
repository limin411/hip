/**
 * Display helpers for knowledge schema props / option values / default views.
 * Values stored on disk stay English (FM SoT); UI maps known builtins via i18n.
 */

import type { CollectionView } from './views'

/** Loose translator — avoids coupling to the full typed key union for dynamic maps. */
export type PropTranslate = (key: string) => string

/** Builtin property key → i18n label key. */
export const BUILTIN_PROP_I18N: Record<string, string> = {
  status: 'knowledge.props.status',
  tags: 'knowledge.props.tags',
  aliases: 'knowledge.props.aliases',
  date: 'knowledge.props.date',
  priority: 'knowledge.props.priority',
}

/** Known select option values → i18n (status + priority defaults). */
export const BUILTIN_OPTION_I18N: Record<string, string> = {
  draft: 'knowledge.props.options.draft',
  active: 'knowledge.props.options.active',
  done: 'knowledge.props.options.done',
  low: 'knowledge.props.options.low',
  medium: 'knowledge.props.options.medium',
  high: 'knowledge.props.options.high',
}

/** Default view ids from `DEFAULT_VIEWS` → i18n (only while name matches EN default). */
const DEFAULT_VIEW_I18N: Record<string, { enName: string; key: string }> = {
  view_all_table: { enName: 'All', key: 'knowledge.views.defaultAll' },
  view_status_board: { enName: 'Board', key: 'knowledge.views.defaultBoard' },
}

export function propFieldLabel(
  t: PropTranslate,
  key: string,
  schemaLabel?: string | null,
): string {
  const i18nKey = BUILTIN_PROP_I18N[key]
  if (i18nKey) return t(i18nKey)
  if (schemaLabel?.trim()) return schemaLabel.trim()
  return key
}

export function propOptionLabel(t: PropTranslate, value: string): string {
  const i18nKey = BUILTIN_OPTION_I18N[value]
  if (i18nKey) return t(i18nKey)
  return value
}

/**
 * Localize built-in default view names; keep user-renamed or custom views as stored.
 */
export function collectionViewDisplayName(
  t: PropTranslate,
  view: CollectionView,
): string {
  const def = DEFAULT_VIEW_I18N[view.id]
  if (def && view.name === def.enName) return t(def.key)
  return view.name
}
