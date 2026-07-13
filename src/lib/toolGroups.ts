import type { ToolCall } from '@hip/protocol'
import { toolCategory, type ToolCategory } from './toolPresentation'

export const TOOL_GROUP_THRESHOLD = 8

/** Display order for grouped tools (plan handled separately as todos). */
export const GROUP_ORDER: ToolCategory[] = [
  'delegate',
  'search',
  'read',
  'browse',
  'edit',
  'shell',
  'other',
]

export interface ToolGroup {
  category: ToolCategory
  tools: ToolCall[]
}

export type GroupedToolsResult =
  | { mode: 'flat'; tools: ToolCall[] }
  | { mode: 'grouped'; groups: ToolGroup[] }

/**
 * Group tools for process UI when count ≥ threshold.
 * Excludes write_todos (rendered as TodoChecklist).
 */
export function groupToolCalls(
  tools: ToolCall[],
  threshold = TOOL_GROUP_THRESHOLD,
): GroupedToolsResult {
  const visible = tools.filter((t) => t.name !== 'write_todos')
  const sorted = [...visible].sort((a, b) => a.seq - b.seq)
  if (sorted.length < threshold) {
    return { mode: 'flat', tools: sorted }
  }
  const buckets = new Map<ToolCategory, ToolCall[]>()
  for (const t of sorted) {
    const cat = toolCategory(t.name)
    if (cat === 'plan') continue
    const list = buckets.get(cat) ?? []
    list.push(t)
    buckets.set(cat, list)
  }
  const groups: ToolGroup[] = []
  for (const cat of GROUP_ORDER) {
    const list = buckets.get(cat)
    if (list?.length) groups.push({ category: cat, tools: list })
  }
  return { mode: 'grouped', groups }
}
