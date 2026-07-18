import type {
  ContextGroupId,
  ContextKind,
  ContextMenuBuildContext,
  ContextMenuItemDef,
  ContextMenuPrefs,
  ContextProvider,
  ContextRequest,
} from './types'
import { loadPrefs } from './prefs'
import { groupRank } from './groupOrder'
import { agentConfigProvider } from './providers/agentConfig'
import { checkpointProvider } from './providers/checkpoint'
import { codeBlockProvider } from './providers/codeBlock'
import { commitProvider } from './providers/commit'
import { diffFileProvider } from './providers/diffFile'
import { diffHunkProvider } from './providers/diffHunk'
import { fileEntryProvider } from './providers/fileEntry'
import { filePreviewProvider } from './providers/filePreview'
import { mcpServerProvider } from './providers/mcpServer'
import { messageProvider } from './providers/message'
import { pluginProvider } from './providers/plugin'
import { sessionHistoryProvider } from './providers/sessionHistory'
import { worktreeProvider } from './providers/worktree'
import { skillConfigProvider } from './providers/skillConfig'
import { knowledgeNodeProvider } from './providers/knowledgeNode'
import { knowledgeSpaceProvider } from './providers/knowledgeSpace'
import { knowledgeTreeProvider } from './providers/knowledgeTree'
import { subAgentProvider } from './providers/subAgent'
import { terminalProvider } from './providers/terminal'
import { toolCallProvider } from './providers/toolCall'

/**
 * Builtin providers — assembled inside buildContextMenuItems (not side-effect registration).
 */
const BUILTIN_PROVIDERS: ContextProvider[] = [
  agentConfigProvider,
  checkpointProvider,
  codeBlockProvider,
  commitProvider,
  diffFileProvider,
  diffHunkProvider,
  fileEntryProvider,
  filePreviewProvider,
  mcpServerProvider,
  messageProvider,
  pluginProvider,
  sessionHistoryProvider,
  worktreeProvider,
  skillConfigProvider,
  knowledgeNodeProvider,
  knowledgeSpaceProvider,
  knowledgeTreeProvider,
  subAgentProvider,
  terminalProvider,
  toolCallProvider,
]

const extraProviders: ContextProvider[] = []

/** Register an extra provider (tests / in-app modules). Returns unregister. */
export function registerContextProvider(provider: ContextProvider): () => void {
  extraProviders.push(provider)
  return () => {
    const i = extraProviders.indexOf(provider)
    if (i >= 0) extraProviders.splice(i, 1)
  }
}

/** Test helper: clear all extra providers. Builtins always remain. */
export function clearContextProviders(): void {
  extraProviders.length = 0
}

/**
 * Merge items: stable group order, first-wins on duplicate ids, separators between groups.
 */
export function mergeByGroup(items: ContextMenuItemDef[]): ContextMenuItemDef[] {
  const seen = new Set<string>()
  const byGroup = new Map<ContextGroupId, ContextMenuItemDef[]>()
  const groupOrder: ContextGroupId[] = []

  for (const item of items) {
    if (!item.id || seen.has(item.id)) {
      if (item.id && seen.has(item.id) && import.meta.env.DEV) {
        console.warn(`[context-menu] duplicate id skipped: ${item.id}`)
      }
      continue
    }
    seen.add(item.id)
    if (!byGroup.has(item.group)) {
      byGroup.set(item.group, [])
      groupOrder.push(item.group)
    }
    byGroup.get(item.group)!.push(item)
  }

  groupOrder.sort((a, b) => groupRank(a) - groupRank(b))

  const out: ContextMenuItemDef[] = []
  for (let gi = 0; gi < groupOrder.length; gi++) {
    const g = groupOrder[gi]!
    const list = byGroup.get(g) ?? []
    for (let i = 0; i < list.length; i++) {
      const item = list[i]!
      const separatorBefore = item.separatorBefore || (gi > 0 && i === 0)
      out.push(separatorBefore ? { ...item, separatorBefore: true } : item)
    }
  }
  return out
}

/**
 * After filtering, fix separators so the menu never starts with a leading separator.
 * Group boundaries get separatorBefore; within-group provider flags are preserved.
 */
export function restampSeparators(items: ContextMenuItemDef[]): ContextMenuItemDef[] {
  let prevGroup: ContextGroupId | undefined
  return items.map((item, index) => {
    const groupBoundary = prevGroup !== undefined && item.group !== prevGroup
    prevGroup = item.group
    if (index === 0) {
      return item.separatorBefore ? { ...item, separatorBefore: false } : item
    }
    if (groupBoundary) {
      return item.separatorBefore ? item : { ...item, separatorBefore: true }
    }
    return item
  })
}

/**
 * Reorder items using a preferred id list.
 * Known ids appear first in `order` sequence; unknown ids keep relative order after.
 */
export function applyOrderByIds(
  items: ContextMenuItemDef[],
  order: string[],
): ContextMenuItemDef[] {
  if (!order.length || items.length <= 1) return items
  const byId = new Map(items.map((item) => [item.id, item]))
  const ordered: ContextMenuItemDef[] = []
  const used = new Set<string>()
  for (const id of order) {
    const item = byId.get(id)
    if (item && !used.has(id)) {
      ordered.push(item)
      used.add(id)
    }
  }
  for (const item of items) {
    if (!used.has(item.id)) ordered.push(item)
  }
  return ordered
}

/**
 * Filter disabledIds, optionally reorder via orderByKind[kind], then restamp separators.
 * Always restamp so a leading separatorBefore never survives merge.
 */
export function applyPrefs(
  items: ContextMenuItemDef[],
  prefs: ContextMenuPrefs = loadPrefs(),
  kind?: ContextKind,
): ContextMenuItemDef[] {
  let next = items
  if (prefs.disabledIds.length) {
    const disabled = new Set(prefs.disabledIds)
    next = next.filter((item) => !disabled.has(item.id))
  }
  if (kind && prefs.orderByKind?.[kind]?.length) {
    next = applyOrderByIds(next, prefs.orderByKind[kind]!)
  }
  return restampSeparators(next)
}

export function buildContextMenuItems(
  req: ContextRequest,
  ctx: ContextMenuBuildContext,
  prefs: ContextMenuPrefs = loadPrefs(),
): ContextMenuItemDef[] {
  const raw = [...BUILTIN_PROVIDERS, ...extraProviders]
    .flatMap((p) => p(req, ctx))
    .filter((item) => Boolean(item?.id))
  return applyPrefs(mergeByGroup(raw), prefs, req.kind)
}
