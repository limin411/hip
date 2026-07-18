import { useTranslation } from 'react-i18next'
import { FileText, Trash2 } from 'lucide-react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'

/** Modal shown before creating a doc when the space has templates. Cancel = no node. */
export function TemplatePickerModal() {
  const { t } = useTranslation()
  const picker = useKnowledgeStore((s) => s.templatePicker)
  const busy = useKnowledgeStore((s) => s.busy)
  const confirmTemplateCreate = useKnowledgeStore((s) => s.confirmTemplateCreate)
  const cancelTemplateCreate = useKnowledgeStore((s) => s.cancelTemplateCreate)
  const deleteTemplate = useKnowledgeStore((s) => s.deleteTemplate)

  return (
    <Modal
      open={picker != null}
      onOpenChange={(o) => {
        if (!o) cancelTemplateCreate()
      }}
      title={t('knowledge.template.pickTitle')}
      className="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            data-testid="knowledge-template-pick-cancel"
            onClick={() => cancelTemplateCreate()}
          >
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2 px-3 py-3" data-testid="knowledge-template-picker">
        <p className="px-2 pb-2 text-meta text-ink-secondary">
          {t('knowledge.template.pickHint')}
        </p>
        <button
          type="button"
          data-testid="knowledge-template-empty"
          disabled={busy}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-3 text-left transition-colors',
            'hover:bg-state-hover disabled:opacity-50',
          )}
          onClick={() => void confirmTemplateCreate(null)}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted">
            <FileText size={14} className="text-ink-tertiary" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-medium text-ink">
              {t('knowledge.template.empty')}
            </span>
            <span className="block truncate text-meta text-ink-tertiary">
              {t('knowledge.template.emptyHint')}
            </span>
          </span>
        </button>
        {(picker?.templates ?? []).map((tpl) => (
          <div
            key={tpl.id}
            className="group flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-3 hover:bg-state-hover"
          >
            <button
              type="button"
              data-testid={`knowledge-template-item-${tpl.id}`}
              disabled={busy}
              className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-50"
              onClick={() => void confirmTemplateCreate(tpl.id)}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted">
                <FileText size={14} className="text-accent-strong" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">{tpl.name}</span>
                <span className="block truncate text-meta text-ink-tertiary">
                  {tpl.body.trim()
                    ? tpl.body.trim().slice(0, 80).replace(/\s+/g, ' ')
                    : t('knowledge.template.noPreview')}
                </span>
              </span>
            </button>
            <button
              type="button"
              data-testid={`knowledge-template-delete-${tpl.id}`}
              disabled={busy}
              title={t('knowledge.template.delete')}
              aria-label={t('knowledge.template.delete')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-tertiary opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100 disabled:opacity-50"
              onClick={(e) => {
                e.stopPropagation()
                void deleteTemplate(tpl.id)
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
