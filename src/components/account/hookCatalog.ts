import type { HookEvent, PluginMeta } from '@hip/protocol'

/** Canonical lifecycle hook events supported by hip (order matches protocol docs). */
export const HOOK_EVENT_CATALOG = [
  'SessionStart',
  'TurnStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'TurnComplete',
  'Stop',
  'PermissionRequest',
  'ActivityStart',
  'ActivityEnd',
  'ActivityBudgetRequest',
] as const satisfies readonly HookEvent[]

/** Typed i18n keys for each catalog event (keeps t() keys exhaustive). */
export const HOOK_EVENT_DESC_KEYS = {
  SessionStart: 'settings.hooks.events.SessionStart',
  TurnStart: 'settings.hooks.events.TurnStart',
  UserPromptSubmit: 'settings.hooks.events.UserPromptSubmit',
  PreToolUse: 'settings.hooks.events.PreToolUse',
  PostToolUse: 'settings.hooks.events.PostToolUse',
  PostToolUseFailure: 'settings.hooks.events.PostToolUseFailure',
  TurnComplete: 'settings.hooks.events.TurnComplete',
  Stop: 'settings.hooks.events.Stop',
  PermissionRequest: 'settings.hooks.events.PermissionRequest',
  ActivityStart: 'settings.hooks.events.ActivityStart',
  ActivityEnd: 'settings.hooks.events.ActivityEnd',
  ActivityBudgetRequest: 'settings.hooks.events.ActivityBudgetRequest',
} as const satisfies Record<HookEvent, string>

/** Per-event path footnotes (declare ≠ dispatch scope). */
export const HOOK_EVENT_PATH_NOTE_KEYS = {
  SessionStart: 'settings.hooks.events.pathNotes.SessionStart',
  TurnStart: 'settings.hooks.events.pathNotes.TurnStart',
  UserPromptSubmit: 'settings.hooks.events.pathNotes.UserPromptSubmit',
  PreToolUse: 'settings.hooks.events.pathNotes.PreToolUse',
  PostToolUse: 'settings.hooks.events.pathNotes.PostToolUse',
  PostToolUseFailure: 'settings.hooks.events.pathNotes.PostToolUseFailure',
  TurnComplete: 'settings.hooks.events.pathNotes.TurnComplete',
  Stop: 'settings.hooks.events.pathNotes.Stop',
  PermissionRequest: 'settings.hooks.events.pathNotes.PermissionRequest',
  ActivityStart: 'settings.hooks.events.pathNotes.ActivityStart',
  ActivityEnd: 'settings.hooks.events.pathNotes.ActivityEnd',
  ActivityBudgetRequest: 'settings.hooks.events.pathNotes.ActivityBudgetRequest',
} as const satisfies Record<HookEvent, string>

export function pathNoteKey(event: HookEvent): string {
  return HOOK_EVENT_PATH_NOTE_KEYS[event]
}

export type LifecyclePhaseId = 'session' | 'turn' | 'tool' | 'turnEnd' | 'activity'

/** Lifecycle phases for list grouping (order matches agent loop). */
export const HOOK_EVENT_PHASES: ReadonlyArray<{
  id: LifecyclePhaseId
  /** i18n key under settings.hooks.diagram.* */
  labelKey: string
  events: readonly HookEvent[]
}> = [
  {
    id: 'session',
    labelKey: 'settings.hooks.diagram.phaseSession',
    events: ['SessionStart'],
  },
  {
    id: 'turn',
    labelKey: 'settings.hooks.diagram.phaseTurn',
    events: ['UserPromptSubmit', 'TurnStart'],
  },
  {
    id: 'tool',
    labelKey: 'settings.hooks.diagram.toolLoop',
    events: ['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure'],
  },
  {
    id: 'turnEnd',
    labelKey: 'settings.hooks.diagram.phaseTurnEnd',
    events: ['Stop', 'TurnComplete'],
  },
  {
    id: 'activity',
    labelKey: 'settings.hooks.diagram.phaseActivity',
    events: ['ActivityStart', 'ActivityBudgetRequest', 'ActivityEnd'],
  },
]

const CATALOG_SET = new Set<string>(HOOK_EVENT_CATALOG)

/** Only plugins that are market-enabled contribute hooks to the live/settings view. */
export function enabledPlugins(plugins: PluginMeta[]): PluginMeta[] {
  return plugins.filter((p) => p.enabled === true)
}

/** Plugins that declare at least one hook entry (enabled plugins only). */
export function pluginsWithHooks(plugins: PluginMeta[]): PluginMeta[] {
  return enabledPlugins(plugins).filter((p) => p.hookCount > 0 || (p.hookEvents?.length ?? 0) > 0)
}

/** Sum of hook entries declared by enabled plugins. */
export function totalConfiguredHookCount(plugins: PluginMeta[]): number {
  return enabledPlugins(plugins).reduce((n, p) => n + (p.hookCount > 0 ? p.hookCount : 0), 0)
}

/** Unique configured HookEvent names across enabled plugins (catalog-filtered). */
export function configuredHookEvents(plugins: PluginMeta[]): Set<string> {
  const out = new Set<string>()
  for (const p of enabledPlugins(plugins)) {
    for (const e of p.hookEvents ?? []) {
      if (CATALOG_SET.has(e)) out.add(e)
    }
  }
  return out
}

export type HookEventSource = {
  pluginId: string
  name: string
  dir: string
  hookCount: number
}

/** Map each HookEvent → enabled plugins that declare it (for diagram expand panel). */
export function sourcesByHookEvent(plugins: PluginMeta[]): Map<string, HookEventSource[]> {
  const map = new Map<string, HookEventSource[]>()
  for (const p of enabledPlugins(plugins)) {
    for (const e of p.hookEvents ?? []) {
      if (!CATALOG_SET.has(e)) continue
      const list = map.get(e) ?? []
      list.push({
        pluginId: p.id,
        name: p.name,
        dir: p.dir,
        hookCount: p.hookCount,
      })
      map.set(e, list)
    }
  }
  return map
}
