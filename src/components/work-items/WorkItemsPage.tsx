import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckSquare } from 'lucide-react'
import {
  filterItems,
  localTodayYmd,
  sortWorkItems,
} from '@/domain/work-items'
import { useUiStore } from '@/store/uiStore'
import { useWorkItemStore } from '@/store/workItemStore'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import { WorkItemListPane } from './WorkItemListPane'
import { WorkItemDetailPane } from './WorkItemDetailPane'

const NARROW_MQ = '(max-width: 719px)'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

/**
 * Master-detail work item surface (flag-gated from AppLayout).
 * Loads catalog on mount; keyboard shortcuts only when activeView is tasks.
 */
export function WorkItemsPage() {
  const { t } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)
  const loaded = useWorkItemStore((s) => s.loaded)
  const loading = useWorkItemStore((s) => s.loading)
  const error = useWorkItemStore((s) => s.error)
  const items = useWorkItemStore((s) => s.items)
  const filterId = useWorkItemStore((s) => s.filterId)
  const search = useWorkItemStore((s) => s.search)
  const selectedId = useWorkItemStore((s) => s.selectedId)
  const select = useWorkItemStore((s) => s.select)
  const createItem = useWorkItemStore((s) => s.createItem)
  const complete = useWorkItemStore((s) => s.complete)
  const reopen = useWorkItemStore((s) => s.reopen)

  const searchRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_MQ).matches : false,
  )
  const [mobileShowDetail, setMobileShowDetail] = useState(false)

  useEffect(() => {
    if (!useWorkItemStore.getState().loaded) {
      void useWorkItemStore.getState().load()
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia(NARROW_MQ)
    const onChange = () => setNarrow(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Enter detail on select when narrow; reset when deselected.
  useEffect(() => {
    if (!selectedId) {
      setMobileShowDetail(false)
      return
    }
    if (narrow) setMobileShowDetail(true)
  }, [selectedId, narrow])

  const today = useMemo(() => localTodayYmd(), [])
  const visible = useMemo(
    () => sortWorkItems(filterItems(items, filterId, today, search)),
    [items, filterId, today, search],
  )

  const focusTitle = useCallback(() => {
    requestAnimationFrame(() => {
      titleRef.current?.focus()
      titleRef.current?.select()
    })
  }, [])

  const handleBack = useCallback(() => {
    select(null)
    setMobileShowDetail(false)
  }, [select])

  useEffect(() => {
    if (activeView !== 'tasks') return

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditableTarget(e.target)) {
        if (e.key === 'Escape' && e.target instanceof HTMLElement) {
          e.target.blur()
          e.preventDefault()
        }
        return
      }

      const key = e.key
      if (key === 'n' || key === 'N') {
        e.preventDefault()
        void createItem().then(() => focusTitle())
        return
      }
      if (key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (key === 'Escape') {
        e.preventDefault()
        if (narrow && mobileShowDetail) {
          handleBack()
        } else {
          select(null)
        }
        return
      }
      // Spec §2.8: Enter keeps/enters detail and focuses title — never complete.
      if (key === 'Enter') {
        e.preventDefault()
        if (!selectedId) {
          if (visible.length === 0) return
          select(visible[0]!.id)
        }
        if (narrow) setMobileShowDetail(true)
        focusTitle()
        return
      }
      if (key === 'j' || key === 'ArrowDown' || key === 'k' || key === 'ArrowUp') {
        e.preventDefault()
        if (visible.length === 0) return
        const idx = selectedId ? visible.findIndex((i) => i.id === selectedId) : -1
        const delta = key === 'j' || key === 'ArrowDown' ? 1 : -1
        const next =
          idx < 0
            ? delta > 0
              ? 0
              : visible.length - 1
            : Math.max(0, Math.min(visible.length - 1, idx + delta))
        select(visible[next]!.id)
        return
      }
      if (key === ' ' || key === 'c' || key === 'C') {
        if (!selectedId) return
        e.preventDefault()
        const item = items.find((i) => i.id === selectedId)
        if (!item) return
        if (item.status === 'done') void reopen(item.id)
        else void complete(item.id)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    activeView,
    complete,
    createItem,
    focusTitle,
    handleBack,
    items,
    mobileShowDetail,
    narrow,
    reopen,
    select,
    selectedId,
    visible,
  ])

  if (!loaded && loading) {
    return (
      <div
        className="flex h-full min-h-0 flex-1 flex-col"
        data-testid="work-items-page"
      >
        <EmptyState
          icon={CheckSquare}
          tier="professional"
          title={t('workItems.loading')}
          className="flex-1"
        />
      </div>
    )
  }

  const showList = !narrow || !mobileShowDetail
  const showDetail = !narrow || mobileShowDetail

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col"
      data-testid="work-items-page"
    >
      {error ? (
        <div
          className="shrink-0 border-b border-danger/30 bg-danger/10 px-4 py-2 text-meta text-danger"
          data-testid="work-item-error"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <WorkItemListPane
          searchInputRef={searchRef}
          onRequestTitleFocus={focusTitle}
          className={cn(
            'flex min-h-0 flex-col border-border',
            showList ? 'flex' : 'hidden',
            narrow ? 'w-full' : 'w-[40%] min-w-[220px] max-w-md border-r',
          )}
        />
        <WorkItemDetailPane
          titleInputRef={titleRef}
          showBack={narrow && mobileShowDetail}
          onBack={handleBack}
          className={cn(showDetail ? 'flex' : 'hidden', !narrow && 'min-w-0 flex-1')}
        />
      </div>
    </div>
  )
}
