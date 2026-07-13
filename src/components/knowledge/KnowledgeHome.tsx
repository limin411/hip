import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, MoreHorizontal, Plus } from 'lucide-react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
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

export function KnowledgeHome() {
  const { t } = useTranslation()
  const spaces = useKnowledgeStore((s) => s.spaces)
  const recent = useKnowledgeStore((s) => s.recent)
  const searchQuery = useKnowledgeStore((s) => s.searchQuery)
  const setSearchQuery = useKnowledgeStore((s) => s.setSearchQuery)
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
  const filteredSpaces = useMemo(
    () => (q ? spaces.filter((s) => s.name.toLowerCase().includes(q)) : spaces),
    [spaces, q],
  )
  const filteredRecent = useMemo(
    () => (q ? recent.filter((r) => r.title.toLowerCase().includes(q)) : recent),
    [recent, q],
  )

  const submitCreate = async () => {
    const name = createName.trim()
    if (!name) return
    const space = await createSpace(name)
    setCreateOpen(false)
    setCreateName('')
    if (space) void openSpace(space.id)
  }

  const submitRename = async () => {
    if (!renameId) return
    const name = renameName.trim()
    if (!name) return
    await renameSpace(renameId, name)
    setRenameId(null)
  }

  const submitDelete = async () => {
    if (!deleteId) return
    await deleteSpace(deleteId)
    setDeleteId(null)
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto" data-testid="knowledge-home">
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-display font-semibold text-ink">{t('knowledge.title')}</h1>
            <p className="mt-1 text-body text-ink-secondary">{t('knowledge.home.subtitle')}</p>
          </div>
          <Button
            data-testid="knowledge-create-space"
            onClick={() => setCreateOpen(true)}
            disabled={busy}
          >
            <Plus size={14} className="mr-1" />
            {t('knowledge.home.createSpace')}
          </Button>
        </div>

        <div className="mb-6">
          <Input
            data-testid="knowledge-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('knowledge.home.searchPlaceholder')}
          />
        </div>

        <p className="mb-2 text-meta font-semibold uppercase tracking-wide text-ink-tertiary">
          {t('knowledge.home.mySpaces')}
        </p>

        {filteredSpaces.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={t('knowledge.home.emptyTitle')}
            description={t('knowledge.home.emptyHint')}
            action={{
              label: t('knowledge.home.createSpace'),
              onClick: () => setCreateOpen(true),
            }}
            className="mb-8"
          />
        ) : (
          <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredSpaces.map((space) => (
              <div
                key={space.id}
                data-testid="knowledge-space-card"
                className="relative flex flex-col rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent/40 hover:shadow-panel"
              >
                <button
                  type="button"
                  className="flex flex-1 flex-col items-start text-left"
                  onClick={() => void openSpace(space.id)}
                >
                  <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-surface-muted text-lg">
                    {space.icon || '📚'}
                  </span>
                  <span className="text-body font-semibold text-ink">{space.name}</span>
                </button>
                <div className="absolute right-2 top-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        data-testid="knowledge-space-menu"
                        className="rounded-md p-1 text-ink-tertiary hover:bg-state-hover hover:text-ink"
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
            ))}
          </div>
        )}

        {filteredRecent.length > 0 && (
          <>
            <p className="mb-2 text-meta font-semibold uppercase tracking-wide text-ink-tertiary">
              {t('knowledge.home.recent')}
            </p>
            <div className="overflow-hidden rounded-xl border border-border">
              {filteredRecent.map((item) => (
                <button
                  key={`${item.spaceId}:${item.docId}`}
                  type="button"
                  data-testid="knowledge-recent-item"
                  className="flex w-full items-center justify-between gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-state-hover"
                  onClick={() => void openRecent(item)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-body text-ink">{item.title}</div>
                    <div className="truncate text-meta text-ink-tertiary">{item.spaceName}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t('knowledge.home.createSpace')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void submitCreate()} disabled={!createName.trim() || busy}>
              {t('common.confirm', { defaultValue: 'OK' })}
            </Button>
          </div>
        }
      >
        <Input
          autoFocus
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          placeholder={t('knowledge.space.namePlaceholder')}
          onKeyDown={(e) => e.key === 'Enter' && void submitCreate()}
        />
      </Modal>

      <Modal
        open={renameId != null}
        onOpenChange={(o) => !o && setRenameId(null)}
        title={t('knowledge.tree.rename')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenameId(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void submitRename()} disabled={!renameName.trim() || busy}>
              {t('common.confirm', { defaultValue: 'OK' })}
            </Button>
          </div>
        }
      >
        <Input
          autoFocus
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submitRename()}
        />
      </Modal>

      <Modal
        open={deleteId != null}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title={t('knowledge.space.deleteConfirm')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteId(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void submitDelete()} disabled={busy}>
              {t('knowledge.tree.delete')}
            </Button>
          </div>
        }
      >
        <p className="text-body text-ink-secondary">{t('knowledge.space.deleteConfirm')}</p>
      </Modal>
    </div>
  )
}
