import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Zap } from 'lucide-react'
import { useAutomationStore } from '@/store/automationStore'
import { sessionService } from '@/domain'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  AutomationEmptyState,
  type SkillSeedDraft,
} from './AutomationEmptyState'
import { AutomationList } from './AutomationList'
import { AutomationEditorModal, type EditorMode } from './AutomationEditorModal'
import { AutomationScheduleBanner } from './AutomationScheduleBanner'
import { AutomationDetailPanel } from './AutomationDetailPanel'
import { AutomationDeleteDialog } from './AutomationDeleteDialog'
import { useInFlightIds } from './useAutomationInFlight'
import type { AutomationTemplate } from './templates'
import { useHipConfigStore } from '@/store/hipConfigStore'
import {
  resolveCloseAction,
  resolveTrayEnabled,
} from '@/ipc/windowPolicy'

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
  const selectedId = useAutomationStore((s) => s.selectedId)
  const select = useAutomationStore((s) => s.select)
  const pendingCreate = useAutomationStore((s) => s.pendingCreate)
  const clearPendingCreate = useAutomationStore((s) => s.clearPendingCreate)

  const [editor, setEditor] = useState<EditorMode>({ mode: 'closed' })
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    name: string
  } | null>(null)
  const runningIds = useInFlightIds()
  const windowCfg = useHipConfigStore((s) => s.config.window)
  const scheduleUnreliable = useMemo(() => {
    const closeAction = resolveCloseAction(windowCfg?.closeAction)
    const trayEnabled = resolveTrayEnabled(windowCfg?.trayEnabled)
    return closeAction === 'quit' || !trayEnabled
  }, [windowCfg?.closeAction, windowCfg?.trayEnabled])

  useEffect(() => {
    if (!useAutomationStore.getState().loaded) {
      void load()
    }
  }, [load])

  // Sidebar "New" sets pendingCreate; open the create editor and clear the flag.
  useEffect(() => {
    if (!pendingCreate) return
    setEditor({ mode: 'create' })
    clearPendingCreate()
  }, [pendingCreate, clearPendingCreate])

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
    if (selectedId && !selected) select(null)
  }, [selectedId, selected, select])

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
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <AutomationList
              automations={automations}
              runningIds={runningIds}
              scheduleUnreliable={scheduleUnreliable}
              selectedId={selected?.id ?? null}
              onSelect={(id) => select(selectedId === id ? null : id)}
              onCreate={openCreate}
              onCreateFromTemplate={openTemplate}
              onToggle={(id, enabled) => void setEnabled(id, enabled)}
              onRun={(id, opts) =>
                void runNow(id, {
                  focus: opts?.focus === true,
                  trigger: 'manual',
                })
              }
              onEdit={openEdit}
              onDelete={(id) => {
                const a = automations.find((x) => x.id === id)
                setDeleteTarget({
                  id,
                  name: a?.name?.trim() || t('automation.untitled'),
                })
              }}
              onOpenLastSession={(id) => {
                const a = automations.find((x) => x.id === id)
                if (a?.lastSessionId) {
                  sessionService.selectSession(a.lastSessionId)
                }
              }}
            />
          </div>
          {selected ? (
            <AutomationDetailPanel
              automation={selected}
              running={runningIds.has(selected.id)}
              scheduleUnreliable={scheduleUnreliable}
              onClose={() => select(null)}
              onRun={(opts) =>
                void runNow(selected.id, {
                  focus: opts?.focus === true,
                  trigger: 'manual',
                })
              }
              onEdit={() => openEdit(selected.id)}
              className="w-[min(22rem,40%)] shrink-0 border-l"
            />
          ) : null}
        </div>
      ) : (
        <AutomationEmptyState
          onStartBlank={openCreate}
          onSelectTemplate={openTemplate}
          onSelectSkill={openSkill}
        />
      )}

      <AutomationEditorModal state={editor} onClose={closeEditor} />

      <AutomationDeleteDialog
        open={deleteTarget != null}
        name={deleteTarget?.name ?? ''}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return
          await remove(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}
