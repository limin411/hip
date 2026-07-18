import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isSpaceNameTaken, normalizeSpaceName } from '@/domain/knowledge/spaceName'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { openSpaceFromSidebar } from '@/components/layout/sidebarActions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import {
  closeKnowledgeSpaceDialog,
  useKnowledgeSpaceDialog,
} from './knowledgeSpaceDialogStore'

/**
 * Global host for knowledge-space create / rename / delete dialogs.
 * Mount once near app chrome (e.g. AppLayout).
 */
export function KnowledgeSpaceDialogHost() {
  const { t } = useTranslation()
  const dialog = useKnowledgeSpaceDialog()
  const spaces = useKnowledgeStore((s) => s.spaces)
  const createSpace = useKnowledgeStore((s) => s.createSpace)
  const renameSpace = useKnowledgeStore((s) => s.renameSpace)
  const deleteSpace = useKnowledgeStore((s) => s.deleteSpace)
  const busy = useKnowledgeStore((s) => s.busy)

  const [name, setName] = useState('')

  // Sync draft name when dialog opens / target changes.
  useEffect(() => {
    if (!dialog) {
      setName('')
      return
    }
    if (dialog.kind === 'create') setName('')
    else if (dialog.kind === 'rename') setName(dialog.name)
  }, [dialog])

  if (!dialog) return null

  const nameTrimmed = normalizeSpaceName(name)
  const excludeId = dialog.kind === 'rename' ? dialog.spaceId : undefined
  const nameTaken =
    nameTrimmed.length > 0 && isSpaceNameTaken(spaces, nameTrimmed, excludeId)

  if (dialog.kind === 'create') {
    const submit = async () => {
      if (!nameTrimmed || nameTaken) return
      const space = await createSpace(nameTrimmed)
      if (!space) return
      closeKnowledgeSpaceDialog()
      await openSpaceFromSidebar(space.id)
    }
    return (
      <Modal
        open
        onOpenChange={(o) => !o && closeKnowledgeSpaceDialog()}
        title={t('sidebar.newSpace')}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeKnowledgeSpaceDialog}>
              {t('common.cancel')}
            </Button>
            <Button
              data-testid="knowledge-create-space-confirm"
              onClick={() => void submit()}
              disabled={!nameTrimmed || nameTaken || busy}
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
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('knowledge.space.namePlaceholder')}
              aria-invalid={nameTaken || undefined}
              className={
                nameTaken
                  ? 'border-danger focus-visible:border-danger focus-visible:ring-danger/10'
                  : undefined
              }
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </label>
          {nameTaken && (
            <p
              className="rounded-md bg-danger/10 px-3 py-2 text-meta text-danger"
              data-testid="knowledge-create-space-name-error"
              role="alert"
            >
              {t('knowledge.space.nameDuplicate', { name: nameTrimmed })}
            </p>
          )}
        </div>
      </Modal>
    )
  }

  if (dialog.kind === 'rename') {
    const spaceId = dialog.spaceId
    const submit = async () => {
      if (!nameTrimmed || nameTaken) return
      const ok = await renameSpace(spaceId, nameTrimmed)
      if (ok) closeKnowledgeSpaceDialog()
    }
    return (
      <Modal
        open
        onOpenChange={(o) => !o && closeKnowledgeSpaceDialog()}
        title={t('knowledge.tree.rename')}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="knowledge-rename-space-cancel"
              onClick={closeKnowledgeSpaceDialog}
            >
              {t('common.cancel')}
            </Button>
            <Button
              data-testid="knowledge-rename-space-confirm"
              onClick={() => void submit()}
              disabled={!nameTrimmed || nameTaken || busy}
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
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('knowledge.space.namePlaceholder')}
              aria-invalid={nameTaken || undefined}
              className={
                nameTaken
                  ? 'border-danger focus-visible:border-danger focus-visible:ring-danger/10'
                  : undefined
              }
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                void submit()
              }}
            />
          </label>
          {nameTaken && (
            <p
              className="rounded-md bg-danger/10 px-3 py-2 text-meta text-danger"
              data-testid="knowledge-rename-space-name-error"
              role="alert"
            >
              {t('knowledge.space.nameDuplicate', { name: nameTrimmed })}
            </p>
          )}
        </div>
      </Modal>
    )
  }

  // delete
  const spaceId = dialog.spaceId
  return (
    <Modal
      open
      onOpenChange={(o) => !o && closeKnowledgeSpaceDialog()}
      title={t('knowledge.space.deleteTitle', { name: dialog.name })}
      className="max-w-sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            data-testid="knowledge-delete-space-cancel"
            onClick={closeKnowledgeSpaceDialog}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            data-testid="knowledge-delete-space-confirm"
            disabled={busy}
            onClick={() => {
              // Close first so RemoveScroll unlocks body before workspace unmounts.
              closeKnowledgeSpaceDialog()
              void deleteSpace(spaceId)
            }}
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
  )
}
