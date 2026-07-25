/**
 * Work Item Tracking surface flag.
 * When false, `activeView: 'tasks'` stays on PlaceholderPage and
 * `isPlaceholderSidebarSection('tasks')` remains true.
 * MUST stay false until PR7 (shell + UI fully wired).
 */
export const WORK_ITEM_TRACKING = false as const
