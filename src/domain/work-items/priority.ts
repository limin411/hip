import type { WorkItemPriority } from './types'

/** Higher rank = higher priority for sort (desc). */
export const PRIORITY_RANK: Record<WorkItemPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
}
