/**
 * Sidebar list pane for work-item tracking: smart filters + user lists.
 * Rendered by AppSidebar when WORK_ITEM_TRACKING && sidebarSection === 'tasks'.
 *
 * List create/rename/delete use in-app Modals — never window.prompt/confirm
 * (WKWebView / Tauri freezes on those blocking dialogs).
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Inbox, List, Plus } from 'lucide-react'
import { INBOX_LIST_ID, type WorkItemList } from '@/domain/work-items'
import { cn } from '@/lib/utils'
import { useWorkItemStore } from '@/store/workItemStore'
import { SIDEBAR_ACTIVE_RAIL } from '@/components/layout/sidebarActiveRail'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

/** Smart filter order (design IA). */
export const WORK_ITEM_SMART_FILTERS = [
  'open',
  'today',
  'overdue',
  'in_progress',
  'done',
  'cancelled',
  'archived',
] as const

export type WorkItemSmartFilterId = (typeof WORK_ITEM_SMART_FILTERS)[number]

function isInboxList(list: WorkItemList): boolean {
  return list.id === INBOX_LIST_ID || list.system === 'inbox'
}

/** Inbox first, then user lists by sortOrder ascending. */
export function orderListsForSidebar(lists: WorkItemList[]): WorkItemList[] {
  const inbox = lists.filter(isInboxList)
  const rest = lists
    .filter((l) => !isInboxList(l))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  // Prefer single inbox row; if missing from store, still show nothing extra.
  return [...inbox, ...rest]
}

type ListDialog =
  | { kind: 'create' }
  | { kind: 'rename'; list: WorkItemList }
  | { kind: 'delete'; list: WorkItemList }

export function WorkItemSidebarLists() {
  const { t } = useTranslation()
  const filterId = useWorkItemStore((s) => s.filterId)
  const lists = useWorkItemStore((s) => s.lists)
  const setFilter = useWorkItemStore((s) => s.setFilter)
  const createList = useWorkItemStore((s) => s.createList)
  const renameList = useWorkItemStore((s) => s.renameList)
  const deleteList = useWorkItemStore((s) => s.deleteList)

  const orderedLists = useMemo(() => orderListsForSidebar(lists), [lists])

  const [dialog, setDialog] = useState<ListDialog | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!dialog) {
      setNameDraft('')
      setBusy(false)
      return
    }
    if (dialog.kind === 'create') setNameDraft('')
    else if (dialog.kind === 'rename') setNameDraft(dialog.list.name)
  }, [dialog])

  const nameTrimmed = nameDraft.trim()
  const closeDialog = () => {
    if (busy) return
    setDialog(null)
  }

  const submitCreate = async () => {
    if (!nameTrimmed || busy) return
    setBusy(true)
    try {
      const id = await createList(nameTrimmed)
      setFilter(`list:${id}`)
      setDialog(null)
    } finally {
      setBusy(false)
    }
  }

  const submitRename = async () => {
    if (!dialog || dialog.kind !== 'rename' || !nameTrimmed || busy) return
    if (nameTrimmed === dialog.list.name) {
      setDialog(null)
      return
    }
    setBusy(true)
    try {
      await renameList(dialog.list.id, nameTrimmed)
      setDialog(null)
    } finally {
      setBusy(false)
    }
  }

  const submitDelete = async () => {
    if (!dialog || dialog.kind !== 'delete' || busy) return
    setBusy(true)
    try {
      await deleteList(dialog.list.id)
      setDialog(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="sidebar-work-items" className="flex flex-col gap-2">
      <ul
        className="m-0 list-none p-0"
        aria-label={t('workItems.filtersAria')}
        data-testid="sidebar-work-item-filters"
      >
        {WORK_ITEM_SMART_FILTERS.map((id) => {
          const active = filterId === id
          return (
            <li key={id}>
              <button
                type="button"
                data-testid={`sidebar-work-item-filter-${id}`}
                data-no-drag
                aria-current={active ? 'true' : undefined}
                onClick={() => setFilter(id)}
                className={cn(
                  'mb-0.5 flex w-full items-start gap-2 rounded-lg px-2.5 py-[var(--row-pad-y-session)] text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                  active ? SIDEBAR_ACTIVE_RAIL : 'hover:bg-state-hover',
                )}
              >
                <span
                  className={cn(
                    'mt-1.5 size-1.5 shrink-0 rounded-full',
                    active ? 'bg-accent' : 'bg-transparent',
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                  {t(`workItems.filters.${id}`)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="mt-1 flex items-center justify-between px-2">
        <span
          className="text-caption font-medium text-ink-tertiary"
          id="sidebar-work-item-lists-heading"
        >
          {t('workItems.listsHeading')}
        </span>
        <button
          type="button"
          data-testid="sidebar-new-work-item-list"
          data-no-drag
          title={t('workItems.newList')}
          aria-label={t('workItems.newList')}
          onClick={() => setDialog({ kind: 'create' })}
          className="rounded-md p-0.5 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
        >
          <Plus size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      <ul
        className="m-0 list-none p-0"
        aria-labelledby="sidebar-work-item-lists-heading"
        data-testid="sidebar-work-item-lists"
      >
        {orderedLists.map((list) => {
          const listFilter = `list:${list.id}`
          const active = filterId === listFilter
          const inbox = isInboxList(list)
          const label = inbox ? t('workItems.inbox') : list.name
          return (
            <li key={list.id}>
              <button
                type="button"
                data-testid={`sidebar-work-item-list-${list.id}`}
                data-no-drag
                aria-current={active ? 'true' : undefined}
                title={
                  inbox
                    ? label
                    : t('workItems.listRowHint', { name: list.name })
                }
                onClick={() => setFilter(listFilter)}
                onDoubleClick={() => {
                  if (inbox) return
                  setDialog({ kind: 'rename', list })
                }}
                onContextMenu={(e) => {
                  if (inbox) return
                  e.preventDefault()
                  setDialog({ kind: 'delete', list })
                }}
                className={cn(
                  'mb-0.5 flex w-full items-start gap-2 rounded-lg px-2.5 py-[var(--row-pad-y-session)] text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                  active ? SIDEBAR_ACTIVE_RAIL : 'hover:bg-state-hover',
                )}
              >
                <span
                  className={cn(
                    'mt-1.5 size-1.5 shrink-0 rounded-full',
                    active ? 'bg-accent' : 'bg-transparent',
                  )}
                  aria-hidden
                />
                {inbox ? (
                  <Inbox
                    size={14}
                    className="mt-0.5 shrink-0 text-ink-tertiary"
                    aria-hidden
                  />
                ) : (
                  <List
                    size={14}
                    className="mt-0.5 shrink-0 text-ink-tertiary"
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                  {label}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {dialog?.kind === 'create' || dialog?.kind === 'rename' ? (
        <Modal
          open
          onOpenChange={(o) => !o && closeDialog()}
          title={
            dialog.kind === 'create' ? t('workItems.newList') : t('workItems.renameListPrompt')
          }
          className="max-w-sm"
          closeDisabled={busy}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeDialog} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button
                data-testid={
                  dialog.kind === 'create'
                    ? 'work-item-list-create-confirm'
                    : 'work-item-list-rename-confirm'
                }
                onClick={() =>
                  void (dialog.kind === 'create' ? submitCreate() : submitRename())
                }
                disabled={!nameTrimmed || busy}
              >
                {t('common.confirm')}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-3 px-5 py-4">
            <label className="flex flex-col gap-2">
              <span className="text-body text-ink-secondary">{t('workItems.newListPrompt')}</span>
              <Input
                autoFocus
                data-testid="work-item-list-name-input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder={t('workItems.newListPrompt')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void (dialog.kind === 'create' ? submitCreate() : submitRename())
                  }
                }}
              />
            </label>
          </div>
        </Modal>
      ) : null}

      {dialog?.kind === 'delete' ? (
        <Modal
          open
          onOpenChange={(o) => !o && closeDialog()}
          title={t('workItems.deleteListConfirm', { name: dialog.list.name })}
          className="max-w-sm"
          closeDisabled={busy}
          footer={
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                data-testid="work-item-list-delete-cancel"
                onClick={closeDialog}
                disabled={busy}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="dangerSoft"
                data-testid="work-item-list-delete-confirm"
                onClick={() => void submitDelete()}
                disabled={busy}
              >
                {t('workItems.actions.delete')}
              </Button>
            </div>
          }
        >
          <div className="px-5 py-4 text-body text-ink-secondary">
            {t('workItems.deleteListConfirm', { name: dialog.list.name })}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
