import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Code2, RotateCcw, Trash2, Search } from 'lucide-react'
import { sessionService } from '@/domain'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { Pagination } from '@/components/ui/Pagination'
import { Modal } from '@/components/ui/Modal'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useTrashListStore } from '@/store/trashListStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { daysLeftInTrash, resolveTrashRetentionDays } from '@/lib/trashRetention'
import { useTrashBadgeStore } from '@/store/trashBadgeStore'

const PAGE_SIZE = 20

type SurfaceFilter = 'all' | 'chat' | 'code'

export function RecycleBinPage() {
  const { t } = useTranslation()
  const sessions = useTrashListStore((s) => s.sessions)
  const loaded = useTrashListStore((s) => s.loaded)
  const retentionRaw = useHipConfigStore((s) => s.config.trash?.retentionDays)
  const loadHip = useHipConfigStore((s) => s.load)
  const hipLoaded = useHipConfigStore((s) => s.loaded)
  const retentionDays = resolveTrashRetentionDays(retentionRaw)

  const [query, setQuery] = useState('')
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>('all')
  const [page, setPage] = useState(1)
  const [hardDeleteId, setHardDeleteId] = useState<string | null>(null)
  const [emptyOpen, setEmptyOpen] = useState(false)

  useEffect(() => {
    if (!hipLoaded) void loadHip()
  }, [hipLoaded, loadHip])

  useEffect(() => {
    sessionService.requestTrashList()
    const onFocus = () => sessionService.requestTrashList()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = [...sessions].sort((a, b) => b.deletedAt - a.deletedAt)
    if (q) {
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          (s.preview ?? '').toLowerCase().includes(q),
      )
    }
    if (surfaceFilter !== 'all') {
      list = list.filter((s) => s.surface === surfaceFilter)
    }
    return list
  }, [sessions, query, surfaceFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const hardTarget = hardDeleteId
    ? sessions.find((s) => s.id === hardDeleteId) ?? null
    : null

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-5" data-testid="recycle-bin-page">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-display font-semibold text-ink">{t('trash.title')}</h2>
        {sessions.length > 0 && (
          <Button variant="danger" size="sm" onClick={() => setEmptyOpen(true)}>
            {t('trash.empty')}
          </Button>
        )}
      </div>
      <p className="mb-4 text-meta text-ink-tertiary">
        {t('trash.subtitle', { retentionDays })}
      </p>

      <div className="relative mb-4 max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(1)
          }}
          placeholder={t('trash.searchPlaceholder')}
          className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-body text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
        />
      </div>

      <div className="mb-4">
        <Tabs
          value={surfaceFilter}
          onValueChange={(v) => {
            setSurfaceFilter(v as SurfaceFilter)
            setPage(1)
          }}
        >
          <TabsList>
            <TabsTrigger value="all">{t('trash.filterAll')}</TabsTrigger>
            <TabsTrigger value="chat">{t('trash.filterChat')}</TabsTrigger>
            <TabsTrigger value="code">{t('trash.filterCode')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {!loaded ? (
        <p className="text-body text-ink-tertiary">{t('common.loading', { defaultValue: 'Loading…' })}</p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-body text-ink-tertiary" data-testid="recycle-bin-empty">
          {t('trash.emptyState')}
        </p>
      ) : (
        <>
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {paged.map((session) => {
              const Icon = session.surface === 'chat' ? MessageSquare : Code2
              const left = daysLeftInTrash(session.deletedAt, retentionDays)
              return (
                <div
                  key={session.id}
                  className="flex items-center gap-3 px-4 py-3"
                  data-testid="recycle-bin-row"
                  data-session-id={session.id}
                >
                  <Icon size={16} className="shrink-0 text-ink-tertiary" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body font-medium text-ink">{session.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-meta text-ink-tertiary">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[11px] font-medium',
                          session.surface === 'chat'
                            ? 'bg-accent/10 text-accent-strong'
                            : 'bg-state-hover text-ink-secondary',
                        )}
                      >
                        {t(`nav.${session.surface}`)}
                      </span>
                      <span>{t('trash.daysLeft', { days: left })}</span>
                      {session.preview ? (
                        <span className="truncate">{session.preview}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        sessionService.restoreSession(session.id)
                        useTrashListStore.getState().removeSession(session.id)
                        useTrashBadgeStore.getState().adjustSessions(-1)
                      }}
                    >
                      <RotateCcw size={14} className="mr-1" />
                      {t('trash.restore')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-ink-secondary hover:text-danger"
                      title={t('trash.deleteForever')}
                      aria-label={t('trash.deleteForever')}
                      onClick={() => setHardDeleteId(session.id)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
          {totalPages > 1 && (
            <div className="mt-4">
              <Pagination currentPage={safePage} totalPages={totalPages} onChange={setPage} />
            </div>
          )}
        </>
      )}

      {hardTarget && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setHardDeleteId(null)
          }}
          title={t('trash.deleteForeverTitle', { title: hardTarget.title })}
          className="max-w-sm"
        >
          <div className="p-5">
            <DialogPrimitive.Description className="text-body text-ink-secondary">
              {t('trash.deleteForeverBody')}
            </DialogPrimitive.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setHardDeleteId(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  sessionService.hardDeleteSession(hardTarget.id, {
                    deleteDerivedMemories: hardTarget.deleteDerivedMemories,
                    reason: 'trash-permanent',
                    meta: { source: 'RecycleBinPage' },
                  })
                  useTrashListStore.getState().removeSession(hardTarget.id)
                  setHardDeleteId(null)
                }}
              >
                {t('trash.deleteForever')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {emptyOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setEmptyOpen(false)
          }}
          title={t('trash.emptyConfirmTitle')}
          className="max-w-sm"
        >
          <div className="p-5">
            <DialogPrimitive.Description className="text-body text-ink-secondary">
              {t('trash.emptyConfirmBody', { count: sessions.length })}
            </DialogPrimitive.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEmptyOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  sessionService.emptySessionTrash()
                  useTrashListStore.getState().clear()
                  useTrashBadgeStore.getState().setSessionCount(0)
                  setEmptyOpen(false)
                }}
              >
                {t('trash.empty')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
