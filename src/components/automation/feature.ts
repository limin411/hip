/**
 * Automations page surface flag.
 * When true, `activeView: 'automation'` renders AutomationsPage and
 * `isPlaceholderSidebarSection('automation')` is false.
 * Rollback: set to `false as const`.
 */
export const AUTOMATION_PAGE = true as const
