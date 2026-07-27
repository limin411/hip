import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, Trash2 } from 'lucide-react'
import {
  WORK_ITEM_TAG_MAX_LEN,
  WORK_ITEM_TAGS_MAX,
  WORK_ITEM_TITLE_MAX,
  ensureScheduleDates,
  localTodayYmd,
  type WorkItemPriority,
  type WorkItemStatus,
} from '@/domain/work-items'
import { useWorkItemStore } from '@/store/workItemStore'
import { useWorkItemViewStore } from '@/store/workItemViewStore'
import { Button } from '@/components/ui/Button'
import { DateField } from '@/components/ui/DateField'
import { Input, inputClassName } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Modal } from '@/components/ui/Modal'
import {
  openWorkItemDeleteDialog,
  useWorkItemDeleteDialog,
} from './workItemDeleteDialogStore'

const PRIMARY_STATUSES: WorkItemStatus[] = ['todo', 'in_progress', 'done']
const PRIORITIES: WorkItemPriority[] = ['none', 'low', 'medium', 'high']

type Draft = {
  title: string
  startOn: string
  endOn: string
  status: WorkItemStatus
  priority: WorkItemPriority
  notes: string
  tags: string[]
}

export function WorkItemEditorModal() {
  const { t } = useTranslation()
  const modal = useWorkItemViewStore((s) => s.modal)
  const closeModal = useWorkItemViewStore((s) => s.closeModal)
  const items = useWorkItemStore((s) => s.items)
  const commitItemDraft = useWorkItemStore((s) => s.commitItemDraft)
  const archive = useWorkItemStore((s) => s.archive)
  const unarchive = useWorkItemStore((s) => s.unarchive)

  const open = modal.mode !== 'closed'
  const editId = modal.mode === 'edit' ? modal.itemId : null
  // Sibling delete confirm is a separate Dialog root; hide the editor while it is
  // open so two Radix overlays/panels do not stack (double-dialog UX).
  const deleteDialog = useWorkItemDeleteDialog()
  const showEditor = open && deleteDialog == null
  const item = useMemo(
    () => (editId ? items.find((i) => i.id === editId) ?? null : null),
    [editId, items],
  )

  const [draft, setDraft] = useState<Draft>(() => emptyDraft())
  const [tagDraft, setTagDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [titleError, setTitleError] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  // Sync draft when session opens / target changes (mode + create defaults / edit id).
  // Do not depend on `item` object identity — only itemId — or in-progress edits get wiped.
  const sessionKey =
    modal.mode === 'closed'
      ? 'closed'
      : modal.mode === 'create'
        ? `c:${modal.defaults.startOn}:${modal.defaults.endOn}:${modal.defaults.status ?? 'todo'}`
        : `e:${modal.itemId}`

  useEffect(() => {
    if (modal.mode === 'closed') return
    setTitleError(false)
    setTagDraft('')
    if (modal.mode === 'create') {
      const today = localTodayYmd()
      const schedule = ensureScheduleDates(
        { startOn: modal.defaults.startOn, endOn: modal.defaults.endOn },
        today,
      )
      setDraft({
        title: '',
        startOn: schedule.startOn,
        endOn: schedule.endOn,
        status: modal.defaults.status ?? 'todo',
        priority: 'none',
        notes: '',
        tags: [],
      })
    } else if (modal.mode === 'edit') {
      const target = items.find((i) => i.id === modal.itemId)
      if (!target) return
      const schedule = ensureScheduleDates(target, localTodayYmd())
      setDraft({
        title: target.title,
        startOn: schedule.startOn,
        endOn: schedule.endOn,
        status: target.status,
        priority: target.priority,
        notes: target.notes,
        tags: [...target.tags],
      })
    }
    requestAnimationFrame(() => titleRef.current?.focus())
  }, [sessionKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // If edit target vanished, close
  useEffect(() => {
    if (modal.mode === 'edit' && editId && !item) closeModal()
  }, [modal.mode, editId, item, closeModal])

  const catalogTags = useMemo(() => {
    const set = new Set<string>()
    for (const i of items) for (const tag of i.tags) set.add(tag)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [items])

  const statuses: WorkItemStatus[] =
    draft.status === 'cancelled'
      ? ['cancelled', ...PRIMARY_STATUSES]
      : PRIMARY_STATUSES

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  const addTag = (raw: string) => {
    const next = raw.trim().slice(0, WORK_ITEM_TAG_MAX_LEN)
    if (!next) return
    if (draft.tags.length >= WORK_ITEM_TAGS_MAX) {
      setTagDraft('')
      return
    }
    if (draft.tags.some((x) => x.toLowerCase() === next.toLowerCase())) {
      setTagDraft('')
      return
    }
    patch({ tags: [...draft.tags, next] })
    setTagDraft('')
  }

  const handleSave = async () => {
    if (!draft.title.trim()) {
      setTitleError(true)
      titleRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      await commitItemDraft(editId, {
        title: draft.title,
        startOn: draft.startOn,
        endOn: draft.endOn,
        status: draft.status,
        priority: draft.priority,
        notes: draft.notes,
        tags: draft.tags,
      })
      closeModal()
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async () => {
    if (!editId) return
    if (!draft.title.trim()) {
      setTitleError(true)
      titleRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      await commitItemDraft(editId, {
        title: draft.title,
        startOn: draft.startOn,
        endOn: draft.endOn,
        status: draft.status,
        priority: draft.priority,
        notes: draft.notes,
        tags: draft.tags,
      })
      await archive(editId)
      closeModal()
    } finally {
      setSaving(false)
    }
  }

  const handleUnarchive = async () => {
    if (!editId) return
    setSaving(true)
    try {
      // Flush draft then unarchive and close (consistent with archive).
      if (draft.title.trim()) {
        await commitItemDraft(editId, {
          title: draft.title,
          startOn: draft.startOn,
          endOn: draft.endOn,
          status: draft.status,
          priority: draft.priority,
          notes: draft.notes,
          tags: draft.tags,
        })
      }
      await unarchive(editId)
      closeModal()
    } finally {
      setSaving(false)
    }
  }

  // Keep session mounted while delete confirm is up so cancel restores the editor.
  if (!open) return null

  const title =
    modal.mode === 'create' ? t('workItems.modal.createTitle') : t('workItems.modal.editTitle')

  return (
    <Modal
        open={showEditor}
        onOpenChange={(o) => {
          // Ignore dismiss while deliberately hidden for the delete confirm.
          if (!o && !saving && deleteDialog == null) closeModal()
        }}
        title={title}
        closeDisabled={saving}
        className="max-w-md"
        footer={
          <div className="flex w-full items-center gap-2">
            {editId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-danger"
                data-testid="work-item-delete"
                onClick={() => {
                  const label =
                    draft.title.trim() || item?.title.trim() || t('workItems.untitled')
                  openWorkItemDeleteDialog(editId, label)
                }}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t('workItems.actions.delete')}
              </Button>
            ) : null}
            <div className="flex-1" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="work-item-modal-cancel"
              disabled={saving}
              onClick={() => closeModal()}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid="work-item-modal-save"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {t('workItems.modal.save')}
            </Button>
          </div>
        }
      >
        <div
          className="flex flex-col gap-4 px-5 py-4"
          data-testid="work-item-editor-body"
        >
          <label className="flex flex-col gap-1">
            <span className="text-meta text-ink-tertiary">{t('workItems.fields.title')}</span>
            <Input
              ref={titleRef}
              data-testid="work-item-title-input"
              value={draft.title}
              maxLength={WORK_ITEM_TITLE_MAX}
              placeholder={t('workItems.fields.titlePlaceholder')}
              aria-invalid={titleError || undefined}
              onChange={(e) => {
                setTitleError(false)
                patch({ title: e.target.value })
              }}
            />
            {titleError ? (
              <span className="text-meta text-danger" data-testid="work-item-title-error">
                {t('workItems.modal.titleRequired')}
              </span>
            ) : null}
          </label>

          <div className="grid grid-cols-2 gap-3">
            {/*
              Use <div> not <label>: DateField is a composite (button + popover).
              A wrapping <label> steals / retargets clicks and can prevent day picks.
            */}
            <div className="flex flex-col gap-1">
              <span className="text-meta text-ink-tertiary">{t('workItems.fields.startOn')}</span>
              <DateField
                data-testid="work-item-start-input"
                aria-label={t('workItems.fields.startOn')}
                value={draft.startOn}
                // No max: past-dated items must still allow jumping start to today.
                // Functional update clamps end so start ≤ end (avoids stale draft).
                onChange={(startOn) => {
                  setDraft((d) => ({
                    ...d,
                    startOn,
                    endOn: startOn > d.endOn ? startOn : d.endOn,
                  }))
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-meta text-ink-tertiary">{t('workItems.fields.endOn')}</span>
              <DateField
                data-testid="work-item-end-input"
                aria-label={t('workItems.fields.endOn')}
                value={draft.endOn}
                onChange={(endOn) => {
                  setDraft((d) => ({
                    ...d,
                    endOn,
                    startOn: endOn < d.startOn ? endOn : d.startOn,
                  }))
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-meta text-ink-tertiary">{t('workItems.fields.status')}</span>
              <select
                data-testid="work-item-status-select"
                className={inputClassName}
                value={draft.status}
                onChange={(e) => patch({ status: e.target.value as WorkItemStatus })}
              >
                {statuses.map((s) => (
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
                value={draft.priority}
                onChange={(e) => patch({ priority: e.target.value as WorkItemPriority })}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`workItems.priority.${p}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-meta text-ink-tertiary">{t('workItems.fields.tags')}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.tags.map((tag) => (
                <span
                  key={tag}
                  data-testid="work-item-tag"
                  className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-0.5 text-caption text-ink-secondary"
                >
                  {tag}
                  <button
                    type="button"
                    className="text-ink-tertiary hover:text-danger"
                    data-testid="work-item-tag-remove"
                    onClick={() => patch({ tags: draft.tags.filter((x) => x !== tag) })}
                  >
                    ×
                  </button>
                </span>
              ))}
              {draft.tags.length < WORK_ITEM_TAGS_MAX ? (
                <input
                  list="work-item-modal-tag-suggestions"
                  data-testid="work-item-tag-input"
                  className="h-7 min-w-[7rem] rounded-full border border-dashed border-border bg-transparent px-2 text-caption"
                  placeholder={t('workItems.fields.tagsPlaceholder')}
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault()
                      addTag(tagDraft.replace(/,/g, ''))
                    }
                  }}
                />
              ) : null}
              <datalist id="work-item-modal-tag-suggestions">
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
              rows={4}
              value={draft.notes}
              placeholder={t('workItems.fields.notesPlaceholder')}
              onChange={(e) => patch({ notes: e.target.value })}
            />
          </label>

          {editId && item ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {item.archivedAt == null ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="work-item-archive"
                  disabled={saving}
                  onClick={() => void handleArchive()}
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
                  onClick={() => void handleUnarchive()}
                >
                  <Archive className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t('workItems.actions.unarchive')}
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </Modal>
  )
}

function emptyDraft(): Draft {
  const today = localTodayYmd()
  return {
    title: '',
    startOn: today,
    endOn: today,
    status: 'todo',
    priority: 'none',
    notes: '',
    tags: [],
  }
}
