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

/** Plugins that declare at least one hook entry. */
export function pluginsWithHooks(plugins: PluginMeta[]): PluginMeta[] {
  return plugins.filter((p) => p.hookCount > 0)
}

/** Sum of hook entries declared by installed plugins. */
export function totalConfiguredHookCount(plugins: PluginMeta[]): number {
  return plugins.reduce((n, p) => n + (p.hookCount > 0 ? p.hookCount : 0), 0)
}
