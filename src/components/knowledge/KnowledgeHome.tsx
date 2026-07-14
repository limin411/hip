import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, FileText, MoreHorizontal, Plus, Search, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { scheduleActiveExpandPersist, useKnowledgeStore } from '@/store/knowledgeStore'
import { isSpaceNameTaken, normalizeSpaceName } from '@/domain/knowledge/spaceName'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/DropdownMenu'
import { pickDirectory } from '@/ipc/dialog'
import { knowledgeErrorMessage, knowledgeImportFolder } from '@/ipc/knowledge'
import { formatRelativeTime } from '@/lib/datetime'

export function KnowledgeHome() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const spaces = useKnowledgeStore((s) => s.spaces)
  const recent = useKnowledgeStore((s) => s.recent)
  const spaceDocCounts = useKnowledgeStore((s) => s.spaceDocCounts)
  const searchQuery = useKnowledgeStore((s) => s.searchQuery)
  const setSearchQuery = useKnowledgeStore((s) => s.setSearchQuery)
  const searchHits = useKnowledgeStore((s) => s.searchHits)
  const indexStatus = useKnowledgeStore((s) => s.indexStatus)
  const createSpace = useKnowledgeStore((s) => s.createSpace)
  const renameSpace = useKnowledgeStore((s) => s.renameSpace)
  const deleteSpace = useKnowledgeStore((s) => s.deleteSpace)
  const openSpace = useKnowledgeStore((s) => s.openSpace)
  const openRecent = useKnowledgeStore((s) => s.openRecent)
  const busy = useKnowledgeStore((s) => s.busy)

  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const q = searchQuery.trim().toLowerCase()
  const searching = q.length > 0

  const filteredSpaces = useMemo(
    () => (q ? spaces.filter((s) => s.name.toLowerCase().includes(q)) : spaces),
    [spaces, q],
  )
  const filteredRecent = useMemo(
    () => (q ? recent.filter((r) => r.title.toLowerCase().includes(q)) : recent),
    [recent, q],
  )

  /** Newest recent open per space — for card meta. */
  const lastOpenBySpace = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of recent) {
      if (!map.has(r.spaceId)) map.set(r.spaceId, r.at)
    }
    return map
  }, [recent])

  const createNameTrimmed = normalizeSpaceName(createName)
  const createNameTaken =
    createNameTrimmed.length > 0 && isSpaceNameTaken(spaces, createNameTrimmed)
  const renameNameTrimmed = normalizeSpaceName(renameName)
  const renameNameTaken =
    renameId != null &&
    renameNameTrimmed.length > 0 &&
    isSpaceNameTaken(spaces, renameNameTrimmed, renameId)

  const submitCreate = async () => {
    const name = normalizeSpaceName(createName)
    if (!name || isSpaceNameTaken(spaces, name)) return
    const space = await createSpace(name)
    if (!space) return
    setCreateOpen(false)
    setCreateName('')
    void openSpace(space.id)
  }

  const submitRename = async () => {
    if (!renameId) return
    const name = normalizeSpaceName(renameName)
    if (!name || isSpaceNameTaken(spaces, name, renameId)) return
    const ok = await renameSpace(renameId, name)
    if (ok) setRenameId(null)
  }

  const submitDelete = async () => {
    if (!deleteId) return
    // Close modal first so body pointer-events unlock before/while delete runs.
    const id = deleteId
    setDeleteId(null)
    await deleteSpace(id)
  }

  const importFolder = async () => {
    const dir = await pickDirectory()
    if (!dir) return
    try {
      const result = await knowledgeImportFolder(dir)
      toast.success(
        t('knowledge.import.done', {
          count: result.importedDocs,
          defaultValue: `Imported ${result.importedDocs} documents`,
        }),
      )
      await useKnowledgeStore.getState().loadSpaces()
      await openSpace(result.spaceId)
      const st = useKnowledgeStore.getState()
      const expand: Record<string, boolean> = { ...st.expandedFolderIds }
      for (const n of st.nodes) {
        if (n.kind === 'folder') expand[n.id] = true
      }
      useKnowledgeStore.setState({ expandedFolderIds: expand })
      scheduleActiveExpandPersist()
    } catch (e) {
      toast.error(knowledgeErrorMessage(e))
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-surface" data-testid="knowledge-home">
      <div className="mx-auto w-full max-w-6xl px-8 py-10">
        {/* Header */}
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-stat font-semibold tracking-tight text-ink">
              {t('knowledge.title')}
            </h1>
            <p className="mt-1.5 text-body text-ink-secondary">{t('knowledge.home.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <Button
              variant="secondary"
              data-testid="knowledge-import-folder"
              onClick={() => void importFolder()}
              disabled={busy}
            >
              <Upload size={14} className="mr-1.5" />
              {t('knowledge.import.folder')}
            </Button>
            <Button
              data-testid="knowledge-create-space"
              onClick={() => setCreateOpen(true)}
              disabled={busy}
            >
              <Plus size={14} className="mr-1.5" />
              {t('knowledge.home.createSpace')}
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-10 w-full max-w-xl">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary"
          />
          <Input
            data-testid="knowledge-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('knowledge.home.searchPlaceholder')}
            className="h-10 pl-9"
          />
          {searching && indexStatus === 'building' && (
            <p className="mt-1.5 text-meta text-ink-tertiary">{t('knowledge.home.searchIndexing')}</p>
          )}
        </div>

        {searching ? (
          <section>
            {searchHits.length > 0 ? (
              <>
                <h2 className="mb-3 text-meta font-medium uppercase tracking-wide text-ink-tertiary">
                  {t('knowledge.home.searchResults')}
                  <span className="ml-1.5 normal-case tracking-normal">{searchHits.length}</span>
                </h2>
                <ul className="-mx-2" data-testid="knowledge-search-results">
                  {searchHits.map((hit) => (
                    <li key={`${hit.spaceId}:${hit.docId}`}>
                      <button
                        type="button"
                        data-testid="knowledge-search-hit"
                        className="flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-state-hover"
                        onClick={() =>
                          void openRecent({
                            spaceId: hit.spaceId,
                            docId: hit.docId,
                            title: hit.title,
                            spaceName: hit.spaceName,
                            at: Date.now(),
                          })
                        }
                      >
                        <FileText size={16} className="mt-0.5 shrink-0 text-ink-tertiary" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-body text-ink">{hit.title}</div>
                          <div className="truncate text-meta text-ink-tertiary">
                            {hit.spaceName}
                            {hit.path ? ` · ${hit.path}` : ''}
                          </div>
                          {hit.snippet && (
                            <div
                              className="mt-0.5 line-clamp-2 text-meta text-ink-secondary"
                              data-testid="knowledge-search-snippet"
                            >
                              {hit.snippet}
                            </div>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              indexStatus === 'ready' && (
                <p className="text-meta text-ink-tertiary" data-testid="knowledge-search-empty">
                  {t('knowledge.home.searchEmpty')}
                </p>
              )
            )}
          </section>
        ) : (
          <div className="flex flex-col gap-12 lg:flex-row lg:items-start lg:gap-16">
            {/* Spaces — primary */}
            <section className="min-w-0 flex-1">
              <h2 className="mb-4 text-meta font-medium uppercase tracking-wide text-ink-tertiary">
                {t('knowledge.home.mySpaces')}
                {spaces.length > 0 && (
                  <span className="ml-1.5 normal-case tracking-normal">{spaces.length}</span>
                )}
              </h2>

              {filteredSpaces.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title={t('knowledge.home.emptyTitle')}
                  description={t('knowledge.home.emptyHint')}
                  action={{
                    label: t('knowledge.home.createSpace'),
                    onClick: () => setCreateOpen(true),
                  }}
                  className="border-0"
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredSpaces.map((space) => {
                    const docCount = spaceDocCounts[space.id]
                    const lastOpen = lastOpenBySpace.get(space.id)
                    const metaTime = lastOpen ?? space.updatedAt
                    return (
                      <div
                        key={space.id}
                        data-testid="knowledge-space-card"
                        data-space-id={space.id}
                        data-space-name={space.name}
                        className="group relative flex min-h-[8rem] flex-col rounded-lg border border-border bg-surface transition-colors hover:bg-surface-subtle"
                      >
                        <button
                          type="button"
                          className="flex flex-1 flex-col items-start p-4 text-left"
                          onClick={() => void openSpace(space.id)}
                        >
                          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-muted text-ink-secondary">
                            {space.icon ? (
                              <span className="text-lg leading-none">{space.icon}</span>
                            ) : (
                              <BookOpen size={18} className="text-accent-strong" />
                            )}
                          </span>
                          <span className="line-clamp-2 pr-6 text-body font-semibold leading-snug text-ink">
                            {space.name}
                          </span>
                          <span className="mt-auto pt-3 text-meta text-ink-tertiary">
                            {docCount != null
                              ? t('knowledge.home.docCount', { count: docCount })
                              : t('knowledge.home.docCountPending')}
                            <span className="mx-1.5 opacity-40">·</span>
                            {formatRelativeTime(metaTime, locale)}
                          </span>
                        </button>
                        <div className="absolute right-2 top-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100">
                          {/* modal={false}: modal menu + delete/rename Modal both lock body
                              pointer-events; stacking leaves the app unclickable after close. */}
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                data-testid="knowledge-space-menu"
                                className="rounded-md p-1.5 text-ink-tertiary hover:bg-surface hover:text-ink"
                                aria-label={t('knowledge.space.menu')}
                              >
                                <MoreHorizontal size={16} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                data-testid="knowledge-space-rename"
                                onClick={() => {
                                  setRenameId(space.id)
                                  setRenameName(space.name)
                                }}
                              >
                                {t('knowledge.tree.rename')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-testid="knowledge-space-delete"
                                onClick={() => setDeleteId(space.id)}
                              >
                                {t('knowledge.tree.delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {/* Recent — secondary, no heavy box */}
            {filteredRecent.length > 0 && (
              <aside className="w-full shrink-0 lg:w-72">
                <h2 className="mb-4 text-meta font-medium uppercase tracking-wide text-ink-tertiary">
                  {t('knowledge.home.recent')}
                </h2>
                <ul className="-mx-2">
                  {filteredRecent.map((item) => (
                    <li key={`${item.spaceId}:${item.docId}`}>
                      <button
                        type="button"
                        data-testid="knowledge-recent-item"
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-state-hover"
                        onClick={() => void openRecent(item)}
                      >
                        <FileText size={15} className="shrink-0 text-ink-tertiary" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-body text-ink">{item.title}</div>
                          <div className="truncate text-meta text-ink-tertiary">{item.spaceName}</div>
                        </div>
                        <span className="shrink-0 text-meta tabular-nums text-ink-tertiary">
                          {formatRelativeTime(item.at, locale)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </aside>
            )}
          </div>
        )}
      </div>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t('knowledge.home.createSpace')}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              data-testid="knowledge-create-space-confirm"
              onClick={() => void submitCreate()}
              disabled={!createNameTrimmed || createNameTaken || busy}
            >
              {t('common.confirm', { defaultValue: 'OK' })}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 px-5 py-4">
          <label className="flex flex-col gap-2">
            <span className="text-body text-ink-secondary">{t('knowledge.space.nameLabel')}</span>
            <Input
              autoFocus
              data-testid="knowledge-create-space-name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder={t('knowledge.space.namePlaceholder')}
              aria-invalid={createNameTaken || undefined}
              className={
                createNameTaken
                  ? 'border-danger focus-visible:border-danger focus-visible:ring-danger/10'
                  : undefined
              }
              onKeyDown={(e) => e.key === 'Enter' && void submitCreate()}
            />
          </label>
          {createNameTaken && (
            <p
              className="rounded-md bg-danger/10 px-3 py-2 text-meta text-danger"
              data-testid="knowledge-create-space-name-error"
              role="alert"
            >
              {t('knowledge.space.nameDuplicate', { name: createNameTrimmed })}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={renameId != null}
        onOpenChange={(o) => !o && setRenameId(null)}
        title={t('knowledge.tree.rename')}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="knowledge-rename-space-cancel"
              onClick={() => setRenameId(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              data-testid="knowledge-rename-space-confirm"
              onClick={() => void submitRename()}
              disabled={!renameNameTrimmed || renameNameTaken || busy}
            >
              {t('common.confirm', { defaultValue: 'OK' })}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 px-5 py-4">
          <label className="flex flex-col gap-2">
            <span className="text-body text-ink-secondary">{t('knowledge.space.nameLabel')}</span>
            <Input
              autoFocus
              data-testid="knowledge-rename-space-name"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              placeholder={t('knowledge.space.namePlaceholder')}
              aria-invalid={renameNameTaken || undefined}
              className={
                renameNameTaken
                  ? 'border-danger focus-visible:border-danger focus-visible:ring-danger/10'
                  : undefined
              }
              onKeyDown={(e) => e.key === 'Enter' && void submitRename()}
            />
          </label>
          {renameNameTaken && (
            <p
              className="rounded-md bg-danger/10 px-3 py-2 text-meta text-danger"
              data-testid="knowledge-rename-space-name-error"
              role="alert"
            >
              {t('knowledge.space.nameDuplicate', { name: renameNameTrimmed })}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={deleteId != null}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title={t('knowledge.space.deleteTitle', {
          name: spaces.find((s) => s.id === deleteId)?.name ?? '',
        })}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="knowledge-delete-space-cancel"
              onClick={() => setDeleteId(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              data-testid="knowledge-delete-space-confirm"
              onClick={() => void submitDelete()}
              disabled={busy}
            >
              {t('knowledge.tree.delete')}
            </Button>
          </div>
        }
      >
        <div className="px-5 py-4">
          <p className="text-body leading-relaxed text-ink-secondary">
            {t('knowledge.space.deleteBody')}
          </p>
        </div>
      </Modal>
    </div>
  )
}
