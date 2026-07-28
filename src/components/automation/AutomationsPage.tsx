import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Zap } from 'lucide-react'
import { isInFlight, useAutomationStore } from '@/store/automationStore'
import { EmptyState } from '@/components/ui/EmptyState'
import { AutomationEmptyState } from './AutomationEmptyState'
import { AutomationList } from './AutomationList'
import { AutomationEditorModal, type EditorMode } from './AutomationEditorModal'
import { AutomationScheduleBanner } from './AutomationScheduleBanner'
import { AutomationRunHistory } from './AutomationRunHistory'
import type { AutomationTemplate } from './templates'

/**
 * Automations product surface (flag-gated from AppLayout).
 * Empty → template gallery; list when catalog has items.
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
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

  // Drop selection if the automation was deleted.
  // Must run before any early return so hook order is stable (loaded→loading path).
  const selected = useMemo(
    () =>
      selectedId
        ? (automations.find((a) => a.id === selectedId) ?? null)
        : null,
    [automations, selectedId],
  )
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null)
  }, [selectedId, selected])

  const openCreate = () => setEditor({ mode: 'create' })
  const openTemplate = (template: AutomationTemplate) =>
    setEditor({ mode: 'create', template })
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

      {hasItems ? (
        <div className="flex min-h-0 flex-1 flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3">
            <AutomationList
              automations={automations}
              runningIds={runningIds}
              selectedId={selected?.id ?? null}
              onSelect={(id) =>
                setSelectedId((cur) => (cur === id ? null : id))
              }
              onCreate={openCreate}
              onToggle={(id, enabled) => void setEnabled(id, enabled)}
              onRun={(id) =>
                void runNow(id, { focus: true, trigger: 'manual' })
              }
              onEdit={openEdit}
              onDelete={(id) => {
                if (window.confirm(t('automation.list.deleteConfirm'))) {
                  void remove(id)
                  if (selectedId === id) setSelectedId(null)
                }
              }}
            />
          </div>
          {selected ? (
            <AutomationRunHistory
              automation={selected}
              onClose={() => setSelectedId(null)}
              className="w-[min(22rem,40%)] shrink-0 border-l"
            />
          ) : null}
        </div>
      ) : (
        <AutomationEmptyState
          onStartBlank={openCreate}
          onSelectTemplate={openTemplate}
        />
      )}

      <AutomationEditorModal state={editor} onClose={closeEditor} />
    </div>
  )
}
