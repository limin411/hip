import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { buildCommitPrompt } from './buildCommitPrompt'

export type ChangesCommitDialogProps = {
  open: boolean
  branch: string | null
  uncommittedPaths: string[]
  onOpenChange: (open: boolean) => void
  onConfirm: (prompt: string) => void
}

export function ChangesCommitDialog({
  open,
  branch,
  uncommittedPaths,
  onOpenChange,
  onConfirm,
}: ChangesCommitDialogProps) {
  const { t } = useTranslation()
  const [message, setMessage] = useState('')
  const [filesNote, setFilesNote] = useState('')

  useEffect(() => {
    if (!open) return
    setMessage('')
    setFilesNote('')
  }, [open])

  const branchLabel = branch?.trim() || t('artifact.changesView.commitBranchUnknown')

  const submit = () => {
    const prompt = buildCommitPrompt({
      branch: branchLabel,
      message,
      filesNote,
      uncommittedPaths,
      messageByAgent: t('artifact.changesView.commitMessageByAgent'),
      filesByAgent: t('artifact.changesView.commitFilesByAgent'),
      template: t('artifact.changesView.commitPrompt'),
    })
    onConfirm(prompt)
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('artifact.changesView.commitTitle')}
      variant="task"
      className="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            data-testid="changes-commit-cancel"
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            data-testid="changes-commit-confirm"
          >
            {t('artifact.changesView.commitConfirm')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        <p className="sr-only">{t('artifact.changesView.commitDescription')}</p>

        <div className="flex flex-col gap-1.5">
          <span className="text-meta font-medium text-ink-secondary">
            {t('artifact.changesView.commitBranch')}
          </span>
          <div
            className="flex h-9 items-center gap-2 rounded-sm border border-border bg-surface-subtle px-3 text-body text-ink"
            data-testid="changes-commit-branch"
          >
            <GitBranch size={14} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
            <span className="min-w-0 truncate font-mono text-meta">{branchLabel}</span>
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-meta font-medium text-ink-secondary">
            {t('artifact.changesView.commitMessage')}
          </span>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder={t('artifact.changesView.commitMessagePlaceholder')}
            data-testid="changes-commit-message"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-meta font-medium text-ink-secondary">
            {t('artifact.changesView.commitFiles')}
          </span>
          <Textarea
            value={filesNote}
            onChange={(e) => setFilesNote(e.target.value)}
            rows={3}
            placeholder={t('artifact.changesView.commitFilesPlaceholder')}
            data-testid="changes-commit-files"
          />
          {uncommittedPaths.length > 0 && (
            <p className="text-caption text-ink-tertiary" data-testid="changes-commit-files-hint">
              {t('artifact.changesView.commitFilesHint', { count: uncommittedPaths.length })}
            </p>
          )}
        </label>
      </div>
    </Modal>
  )
}
