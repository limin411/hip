/**
 * Work Item Tracking surface flag.
 * When true, `activeView: 'tasks'` renders WorkItemsPage and
 * `isPlaceholderSidebarSection('tasks')` is false (`tasks` leaves PlaceholderSidebarSection).
 * Rollback: set to `false as const`.
 */
export const WORK_ITEM_TRACKING = true as const
