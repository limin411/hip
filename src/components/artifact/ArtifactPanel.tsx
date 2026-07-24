import { X } from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useTranslation } from 'react-i18next'
import type { ArtifactTab } from '@/store/uiStore'
import { useUiStore } from '@/store/uiStore'
import { useActiveSessionId } from '@/domain'
import { Button } from '@/components/ui/Button'
import { FileTree } from './FileTree'
import { FilePreview } from './FilePreview'
import { ConversationOutline } from './ConversationOutline'
import { TimelineView } from './TimelineView'
import { ChangesView } from './ChangesView'
import { GitInitBanner } from './GitInitBanner'
import { BranchSwitcher } from './BranchSwitcher'
import { TerminalView } from './TerminalView'
import { AgentsRuntimeSplit } from './AgentsRuntimeSplit'
import { CODE_TERMINAL } from './terminalFeature'
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffStore } from '@/store/diffStore'
import { useFocusStore } from '@/store/focusStore'
import { visibleArtifactTabs } from './visibleArtifactTabs'
import { cn } from '@/lib/utils'
const GIT_GATED: ReadonlySet<ArtifactTab> = new Set(['timeline', 'changes'])

function tabLabel(
  tab: ArtifactTab,
  t: (
    key:
      | 'artifact.files'
      | 'artifact.agents'
      | 'artifact.outline'
      | 'artifact.timeline'
      | 'artifact.changes'
      | 'artifact.terminal',
  ) => string,
): string {
  if (tab === 'files') return t('artifact.files')
  // agents + tasks share the combined Agents/Runtime page
  if (tab === 'agents' || tab === 'tasks') return t('artifact.agents')
  if (tab === 'outline') return t('artifact.outline')
  if (tab === 'timeline') return t('artifact.timeline')
  if (tab === 'changes') return t('artifact.changes')
  return t('artifact.terminal')
}

function resolveEffectiveTab(activeTab: ArtifactTab, isGitRepo: boolean): ArtifactTab {
  if (GIT_GATED.has(activeTab) && !isGitRepo) return 'files'
  // Flag-off leftover: treat like gated tab fallback.
  if (activeTab === 'terminal' && !CODE_TERMINAL) return 'files'
  // Legacy 'tasks' tab id opens the combined agents+runtime page.
  if (activeTab === 'tasks') return 'agents'
  return activeTab
}

export function ArtifactPanel() {
  const { t } = useTranslation()
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const activeSessionId = useActiveSessionId()
  const setSessionCodePanelOpen = useDomainStore((s) => s.setSessionCodePanelOpen)
  const sid = useDomainStore((s) => s.activeSessionId)
  const isGitRepo = useDiffStore((s) => (sid ? s.bySession[sid]?.isGitRepo : false)) ?? false
  const changeFileCount =
    useDiffStore((s) => (sid ? s.bySession[sid]?.files?.length : undefined)) ?? 0

  const effectiveTab = resolveEffectiveTab(activeTab, isGitRepo)
  const tabs = visibleArtifactTabs({
    surface: 'code',
    isGitRepo,
    codeTerminal: CODE_TERMINAL,
  }).filter((tab) => !tab.gated)

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-surface">
      <div
        data-tauri-drag-region
        className="flex h-[var(--titlebar-height)] shrink-0 items-center justify-between border-b border-border px-2"
      >
        <span
          className="truncate px-1.5 text-body font-medium tracking-tight text-ink"
          data-tauri-drag-region="false"
          data-testid="panel-title"
        >
          {tabLabel(effectiveTab, t)}
        </span>
        <div className="flex items-center gap-1" data-tauri-drag-region="false">
          {isGitRepo && <BranchSwitcher />}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (!activeSessionId) return
              useFocusStore.getState().dismissPanelThisTurn()
              setSessionCodePanelOpen(activeSessionId, false)
            }}
            title={t('artifact.closePanel')}
          >
            <X size={16} strokeWidth={1.75} />
          </Button>
        </div>
      </div>

      {/* Second-row tab chrome (craft PR-8) — does not squeeze titlebar drag row. */}
      <div
        className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-1.5"
        role="tablist"
        aria-label={t('artifact.panelTabsAria', { defaultValue: 'Panel tabs' })}
        data-testid="artifact-panel-tabs"
      >
        {tabs.map((tab) => {
          const selected = effectiveTab === tab.value || (tab.value === 'agents' && effectiveTab === 'tasks')
          const badge =
            tab.value === 'changes' && changeFileCount > 0 ? changeFileCount : null
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`artifact-panel-tab-${tab.value}`}
              onClick={() => setTab(tab.value as ArtifactTab)}
              className={cn(
                'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-meta transition-colors duration-chrome',
                selected
                  ? 'bg-state-hover font-medium text-ink'
                  : 'text-ink-tertiary hover:bg-state-hover hover:text-ink-secondary',
              )}
            >
              {t(tab.labelKey)}
              {badge != null && (
                <span
                  className="rounded bg-surface-muted px-1 text-caption tabular-nums text-ink-tertiary"
                  data-testid="artifact-changes-badge"
                >
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden" data-testid={`panel-view-${effectiveTab}`}>
        {effectiveTab === 'outline' && <ConversationOutline />}
        {effectiveTab === 'files' && (
          <div className="flex h-full flex-col">
            {!isGitRepo && <GitInitBanner />}
            <PanelGroup direction="horizontal" className="min-h-0 flex-1">
              <Panel defaultSize={42} minSize={24}><FileTree /></Panel>
              <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
                <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
              </PanelResizeHandle>
              <Panel minSize={30}><FilePreview /></Panel>
            </PanelGroup>
          </div>
        )}
        {effectiveTab === 'agents' && (
          <div className="h-full min-h-0 overflow-hidden">
            <AgentsRuntimeSplit />
          </div>
        )}
        {effectiveTab === 'timeline' && isGitRepo && <TimelineView />}
        {effectiveTab === 'changes' && isGitRepo && <ChangesView />}
        {effectiveTab === 'terminal' && CODE_TERMINAL && <TerminalView />}
      </div>
    </div>
  )
}
