/**
 * Automations page surface flag.
 * When true, `activeView: 'automation'` renders AutomationsPage and
 * `isPlaceholderSidebarSection('automation')` is false.
 * Rollback / until PR4 wiring: keep `false as const`.
 */
export const AUTOMATION_PAGE = false as const
