import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Archive, Ban, Trash2 } from 'lucide-react'
import {
  INBOX_LIST_ID,
  WORK_ITEM_TAG_MAX_LEN,
  WORK_ITEM_TAGS_MAX,
  WORK_ITEM_TITLE_MAX,
  type WorkItemPriority,
  type WorkItemStatus,
} from '@/domain/work-items'
import { useWorkItemStore } from '@/store/workItemStore'
import { Button } from '@/components/ui/Button'
import { Input, inputClassName } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'

const STATUSES: WorkItemStatus[] = ['todo', 'in_progress', 'done', 'cancelled']
const PRIORITIES: WorkItemPriority[] = ['none', 'low', 'medium', 'high']

export interface WorkItemDetailPaneProps {
  titleInputRef?: React.RefObject<HTMLInputElement | null>
  onBack?: () => void
  showBack?: boolean
  className?: string
}

export function WorkItemDetailPane({
  titleInputRef,
  onBack,
  showBack,
  className,
}: WorkItemDetailPaneProps) {
  const { t } = useTranslation()
  const items = useWorkItemStore((s) => s.items)
  const lists = useWorkItemStore((s) => s.lists)
  const selectedId = useWorkItemStore((s) => s.selectedId)
  const updateItem = useWorkItemStore((s) => s.updateItem)
  const setStatus = useWorkItemStore((s) => s.setStatus)
  const archive = useWorkItemStore((s) => s.archive)
  const unarchive = useWorkItemStore((s) => s.unarchive)
  const cancel = useWorkItemStore((s) => s.cancel)
  const deleteItem = useWorkItemStore((s) => s.deleteItem)
  const finalizeSelectedItem = useWorkItemStore((s) => s.finalizeSelectedItem)
  const setNotesDraft = useWorkItemStore((s) => s.setNotesDraft)
  const commitNotesDraft = useWorkItemStore((s) => s.commitNotesDraft)

  const item = useMemo(
    () => (selectedId ? items.find((i) => i.id === selectedId) ?? null : null),
    [items, selectedId],
  )

  const [notesLocal, setNotesLocal] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const localTitleRef = useRef<HTMLInputElement>(null)
  const titleRef = titleInputRef ?? localTitleRef
  const notesItemId = useRef<string | null>(null)

  // Sync notes local state when selection changes (not on every notes save).
  useEffect(() => {
    if (!item) {
      notesItemId.current = null
      setNotesLocal('')
      setTagDraft('')
      setDeleteOpen(false)
      setDeleteBusy(false)
      return
    }
    if (notesItemId.current !== item.id) {
      notesItemId.current = item.id
      setNotesLocal(item.notes)
      setTagDraft('')
      setDeleteOpen(false)
      setDeleteBusy(false)
    }
  }, [item])

  const catalogTags = useMemo(() => {
    const set = new Set<string>()
    for (const i of items) {
      for (const tag of i.tags) set.add(tag)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [items])

  const sortedLists = useMemo(
    () => [...lists].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
    [lists],
  )

  if (!item) {
    return (
      <div
        className={cn('flex min-h-0 flex-1 flex-col', className)}
        data-testid="work-item-detail-pane"
      >
        <EmptyState
          tier="professional"
          title={t('workItems.detailEmpty')}
          description={t('workItems.detailEmptyHint')}
          className="flex-1"
          data-testid="work-item-detail-empty"
        />
      </div>
    )
  }

  const listLabel = (listId: string) => {
    const list = lists.find((l) => l.id === listId)
    if (!list || list.system === 'inbox' || list.id === INBOX_LIST_ID) {
      return t('workItems.inbox')
    }
    return list.name
  }

  const addTag = (raw: string) => {
    const next = raw.trim().slice(0, WORK_ITEM_TAG_MAX_LEN)
    if (!next) return
    if (item.tags.length >= WORK_ITEM_TAGS_MAX) {
      setTagDraft('')
      return
    }
    if (item.tags.some((x) => x.toLowerCase() === next.toLowerCase())) {
      setTagDraft('')
      return
    }
    void updateItem(item.id, { tags: [...item.tags, next] })
    setTagDraft('')
  }

  const removeTag = (tag: string) => {
    void updateItem(item.id, { tags: item.tags.filter((x) => x !== tag) })
  }

  const handleDeleteConfirm = async () => {
    if (deleteBusy) return
    setDeleteBusy(true)
    try {
      await deleteItem(item.id)
      setDeleteOpen(false)
      onBack?.()
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col', className)}
      data-testid="work-item-detail-pane"
      data-item-id={item.id}
    >
      {showBack ? (
        <div className="flex shrink-0 items-center border-b border-border px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="work-item-back-to-list"
            onClick={onBack}
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t('workItems.backToList')}
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <Input
          ref={titleRef as React.RefObject<HTMLInputElement>}
          data-testid="work-item-title-input"
          value={item.title}
          maxLength={WORK_ITEM_TITLE_MAX}
          placeholder={t('workItems.fields.titlePlaceholder')}
          aria-label={t('workItems.fields.title')}
          className="h-10 border-transparent bg-transparent px-0 text-title font-medium shadow-none focus-visible:border-border focus-visible:bg-surface"
          onChange={(e) => void updateItem(item.id, { title: e.target.value })}
          onBlur={() => finalizeSelectedItem()}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-meta text-ink-tertiary">{t('workItems.fields.status')}</span>
            <select
              data-testid="work-item-status-select"
              className={inputClassName}
              value={item.status}
              onChange={(e) => void setStatus(item.id, e.target.value as WorkItemStatus)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`workItems.status.${s}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-meta text-ink-tertiary">{t('workItems.fields.priority')}</span>
            <select
              data-testid="work-item-priority-select"
              className={inputClassName}
              value={item.priority}
              onChange={(e) =>
                void updateItem(item.id, { priority: e.target.value as WorkItemPriority })
              }
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`workItems.priority.${p}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-meta text-ink-tertiary">{t('workItems.fields.dueOn')}</span>
            <input
              type="date"
              data-testid="work-item-due-input"
              className={inputClassName}
              value={item.dueOn ?? ''}
              onChange={(e) =>
                void updateItem(item.id, { dueOn: e.target.value ? e.target.value : null })
              }
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-meta text-ink-tertiary">{t('workItems.fields.list')}</span>
            <select
              data-testid="work-item-list-select"
              className={inputClassName}
              value={item.listId}
              onChange={(e) => void updateItem(item.id, { listId: e.target.value })}
            >
              {sortedLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {listLabel(l.id)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-meta text-ink-tertiary">{t('workItems.fields.tags')}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {item.tags.map((tag) => (
              <span
                key={tag}
                data-testid="work-item-tag"
                className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-0.5 text-caption text-ink-secondary"
              >
                {tag}
                <button
                  type="button"
                  className="text-ink-tertiary hover:text-danger"
                  aria-label={t('workItems.fields.removeTag', { tag })}
                  data-testid="work-item-tag-remove"
                  onClick={() => removeTag(tag)}
                >
                  ×
                </button>
              </span>
            ))}
            {item.tags.length < WORK_ITEM_TAGS_MAX ? (
              <input
                list="work-item-tag-suggestions"
                data-testid="work-item-tag-input"
                className="h-7 min-w-[7rem] rounded-full border border-dashed border-border bg-transparent px-2 text-caption text-ink placeholder:text-ink-tertiary"
                placeholder={t('workItems.fields.tagsPlaceholder')}
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addTag(tagDraft.replace(/,/g, ''))
                  }
                }}
                onBlur={() => {
                  if (tagDraft.trim()) addTag(tagDraft)
                }}
              />
            ) : null}
            <datalist id="work-item-tag-suggestions">
              {catalogTags.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-meta text-ink-tertiary">{t('workItems.fields.notes')}</span>
          <Textarea
            data-testid="work-item-notes"
            rows={6}
            value={notesLocal}
            placeholder={t('workItems.fields.notesPlaceholder')}
            onChange={(e) => {
              const next = e.target.value
              setNotesLocal(next)
              setNotesDraft(item.id, next)
            }}
            onBlur={() => commitNotesDraft()}
          />
        </label>

        <p className="text-meta leading-relaxed text-ink-tertiary">
          {t('workItems.help.cancelVsArchive')}
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          {item.status !== 'cancelled' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="work-item-cancel"
              onClick={() => void cancel(item.id)}
            >
              <Ban className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('workItems.actions.cancel')}
            </Button>
          ) : null}
          {item.archivedAt == null ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="work-item-archive"
              onClick={() => void archive(item.id)}
            >
              <Archive className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('workItems.actions.archive')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="work-item-unarchive"
              onClick={() => void unarchive(item.id)}
            >
              <Archive className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('workItems.actions.unarchive')}
            </Button>
          )}
          <Button
            type="button"
            variant="dangerSoft"
            size="sm"
            data-testid="work-item-delete"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t('workItems.actions.delete')}
          </Button>
        </div>
      </div>

      <Modal
        open={deleteOpen}
        onOpenChange={(o) => {
          if (!o && !deleteBusy) setDeleteOpen(false)
        }}
        title={t('workItems.deleteConfirm')}
        className="max-w-sm"
        closeDisabled={deleteBusy}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="work-item-delete-cancel"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="dangerSoft"
              data-testid="work-item-delete-confirm"
              onClick={() => void handleDeleteConfirm()}
              disabled={deleteBusy}
            >
              {t('workItems.actions.delete')}
            </Button>
          </div>
        }
      >
        <div className="px-5 py-4 text-body text-ink-secondary">
          {t('workItems.deleteConfirm')}
        </div>
      </Modal>
    </div>
  )
}
