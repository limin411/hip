import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Zap } from 'lucide-react'
import { isInFlight, useAutomationStore } from '@/store/automationStore'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { AutomationEmptyState, type SkillSeedDraft } from './AutomationEmptyState'
import { AutomationList } from './AutomationList'
import { AutomationEditorModal, type EditorMode } from './AutomationEditorModal'
import { AutomationScheduleBanner } from './AutomationScheduleBanner'
import type { AutomationTemplate } from './templates'

/**
 * Automations product surface (flag-gated from AppLayout).
 * Empty → template gallery + skills seed; list when catalog has items.
 */
export function AutomationsPage() {
  const { t } = useTranslation()
  const loaded = useAutomationStore((s) => s.loaded)
  const loading = useAutomationStore((s) => s.loading)
  const error = useAutomationStore((s) => s.error)
  const automations = useAutomationStore((s) => s.automations)
  const load = useAutomationStore((s) => s.load)
  const setEnabled = useAutomationStore((s) => s.setEnabled)
  const remove = useAutomationStore((s) => s.remove)
  const runNow = useAutomationStore((s) => s.runNow)

  const [editor, setEditor] = useState<EditorMode>({ mode: 'closed' })
  // Force re-render while any run is in-flight so Run buttons disable.
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!useAutomationStore.getState().loaded) {
      void load()
    }
  }, [load])

  useEffect(() => {
    // Lightweight poll so running state reflects claim without a dedicated store field.
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const openCreate = () => setEditor({ mode: 'create' })
  const openTemplate = (template: AutomationTemplate) =>
    setEditor({ mode: 'create', template })
  const openSkill = (skillSeed: SkillSeedDraft) =>
    setEditor({ mode: 'create', skillSeed })
  const openEdit = (id: string) => setEditor({ mode: 'edit', automationId: id })
  const closeEditor = () => setEditor({ mode: 'closed' })

  if (!loaded && loading) {
    return (
      <div
        className="flex h-full min-h-0 flex-1 flex-col"
        data-testid="automations-page"
      >
        <EmptyState
          icon={Zap}
          tier="professional"
          title={t('automation.loading')}
          className="flex-1"
        />
      </div>
    )
  }

  const hasItems = automations.length > 0
  const runningIds = new Set(
    automations.filter((a) => isInFlight(a.id)).map((a) => a.id),
  )

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col"
      data-testid="automations-page"
    >
      {error ? (
        <div
          className="shrink-0 border-b border-danger/30 bg-danger/10 px-4 py-2 text-meta text-danger"
          data-testid="automation-error"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <AutomationScheduleBanner automations={automations} />

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h1
            className="truncate text-body font-semibold text-ink"
            data-testid="automation-page-title"
          >
            {t('automation.title')}
          </h1>
          <p className="text-meta text-ink-tertiary">{t('automation.subtitle')}</p>
        </div>
        <div className="flex-1" />
        <Button
          type="button"
          size="sm"
          data-testid="automation-new"
          onClick={openCreate}
        >
          {t('automation.startCta')}
        </Button>
      </div>

      {hasItems ? (
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <AutomationList
            automations={automations}
            runningIds={runningIds}
            onToggle={(id, enabled) => void setEnabled(id, enabled)}
            onRun={(id) => void runNow(id, { focus: true, trigger: 'manual' })}
            onEdit={openEdit}
            onDelete={(id) => {
              if (window.confirm(t('automation.list.deleteConfirm'))) {
                void remove(id)
              }
            }}
          />
        </div>
      ) : (
        <AutomationEmptyState
          onStartBlank={openCreate}
          onSelectTemplate={openTemplate}
          onCreateFromSkill={openSkill}
        />
      )}

      <AutomationEditorModal state={editor} onClose={closeEditor} />
    </div>
  )
}
