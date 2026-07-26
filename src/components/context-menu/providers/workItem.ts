import { openUrl } from '@tauri-apps/plugin-opener'
import { openWorkItemDeleteDialog } from '@/components/work-items/workItemDeleteDialogStore'
import { useWorkItemStore } from '@/store/workItemStore'
import { useWorkItemViewStore } from '@/store/workItemViewStore'
import type {
  ContextMenuBuildContext,
  ContextMenuItemDef,
  ContextProvider,
} from '../types'

const MAX_ITEMS = 8

/** First removed → last removed when over cap. Core-4 never listed. */
const DROP_ORDER = [
  'workItem.cancel',
  'workItem.setInProgress',
  'workItem.openUrl',
  'workItem.openKnowledge',
  'workItem.openSession',
  'workItem.archive',
  'workItem.unarchive',
] as const

/** Dynamic imports avoid loading sidebarActions → sessionService at module init (tests). */
async function openWorkItemKnowledgeLink(spaceId: string, docId: string): Promise<void> {
  const [{ leaveWorkItems }, { useUiStore }, { useKnowledgeStore }] = await Promise.all([
    import('@/components/layout/sidebarActions'),
    import('@/store/uiStore'),
    import('@/store/knowledgeStore'),
  ])
  if (useUiStore.getState().activeView === 'tasks') {
    await leaveWorkItems()
  }
  useUiStore.getState().openKnowledgeView()
  useUiStore.getState().setSidebarSection('knowledge')
  const kb = useKnowledgeStore.getState()
  if (!kb.loaded) await kb.loadSpaces()
  await useKnowledgeStore.getState().openSpace(spaceId, { selectDocId: docId })
}

async function openExternalUrl(url: string): Promise<void> {
  try {
    await openUrl(url)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

function applyCap(items: ContextMenuItemDef[]): ContextMenuItemDef[] {
  if (items.length <= MAX_ITEMS) return items
  const next = items.slice()
  for (const id of DROP_ORDER) {
    if (next.length <= MAX_ITEMS) break
    const i = next.findIndex((x) => x.id === id)
    if (i >= 0) next.splice(i, 1)
  }
  return next
}

/** Work item list/bar: status matrix + ≤8 overflow (D18). */
export const workItemProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'workItem') return []
  const { itemId, title, status, archived, links } = req.payload

  const candidates: ContextMenuItemDef[] = []

  // Core-4
  candidates.push({
    id: 'workItem.open',
    label: ctx.t('contextMenu.workItem.open'),
    group: 'primary',
    run: () => {
      useWorkItemViewStore.getState().requestEdit(itemId)
    },
  })

  if (status === 'todo' || status === 'in_progress') {
    candidates.push({
      id: 'workItem.complete',
      label: ctx.t('workItems.actions.complete'),
      group: 'primary',
      run: () => {
        void useWorkItemStore.getState().complete(itemId)
      },
    })
  } else if (status === 'done') {
    candidates.push({
      id: 'workItem.reopen',
      label: ctx.t('workItems.actions.reopen'),
      group: 'primary',
      run: () => {
        void useWorkItemStore.getState().reopen(itemId)
      },
    })
  }

  candidates.push({
    id: 'workItem.copyTitle',
    label: ctx.t('contextMenu.workItem.copyTitle'),
    group: 'clipboard',
    run: () => {
      void ctx.copyText(title)
    },
  })

  candidates.push({
    id: 'workItem.delete',
    label: ctx.t('workItems.actions.delete'),
    group: 'danger',
    danger: true,
    run: () => {
      openWorkItemDeleteDialog(itemId, title)
    },
  })

  // Status band
  if (status === 'todo') {
    candidates.push({
      id: 'workItem.setInProgress',
      label: ctx.t('workItems.status.in_progress'),
      group: 'edit',
      run: () => {
        void useWorkItemStore.getState().setStatus(itemId, 'in_progress')
      },
    })
  }

  if (status === 'todo' || status === 'in_progress') {
    candidates.push({
      id: 'workItem.cancel',
      label: ctx.t('workItems.actions.cancel'),
      group: 'edit',
      run: () => {
        void useWorkItemStore.getState().cancel(itemId)
      },
    })
  }

  if (archived) {
    candidates.push({
      id: 'workItem.unarchive',
      label: ctx.t('workItems.actions.unarchive'),
      group: 'edit',
      run: () => {
        void useWorkItemStore.getState().unarchive(itemId)
      },
    })
  } else {
    candidates.push({
      id: 'workItem.archive',
      label: ctx.t('workItems.actions.archive'),
      group: 'edit',
      run: () => {
        void useWorkItemStore.getState().archive(itemId)
      },
    })
  }

  // Nav band
  if (links.sessionId) {
    candidates.push({
      id: 'workItem.openSession',
      label: ctx.t('contextMenu.workItem.openSession'),
      group: 'navigation',
      run: () => {
        void import('@/components/layout/sidebarActions').then(({ selectSessionFromSidebar }) => {
          void selectSessionFromSidebar(links.sessionId!)
        })
      },
    })
  }
  if (links.knowledge?.spaceId && links.knowledge.docId) {
    candidates.push({
      id: 'workItem.openKnowledge',
      label: ctx.t('contextMenu.workItem.openKnowledge'),
      group: 'navigation',
      run: () => {
        void openWorkItemKnowledgeLink(links.knowledge!.spaceId, links.knowledge!.docId)
      },
    })
  }
  if (links.url) {
    candidates.push({
      id: 'workItem.openUrl',
      label: ctx.t('contextMenu.workItem.openUrl'),
      group: 'navigation',
      run: () => {
        void openExternalUrl(links.url!)
      },
    })
  }

  return applyCap(candidates)
}

/** Exported for unit tests — golden overflow case. */
export function workItemItemIdsForTest(
  payload: {
    status: 'todo' | 'in_progress' | 'done' | 'cancelled'
    archived: boolean
    links: { sessionId?: string; knowledge?: { spaceId: string; docId: string }; url?: string }
  },
  ctx: ContextMenuBuildContext,
): string[] {
  return workItemProvider(
    {
      kind: 'workItem',
      payload: {
        itemId: 't',
        title: 'T',
        status: payload.status,
        archived: payload.archived,
        links: payload.links,
      },
    },
    ctx,
  ).map((i) => i.id)
}
