import { useTranslation } from 'react-i18next'
import { Square } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalAgentStore } from '@/store/terminalAgentStore'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain'
import { isTerminalSession } from '@/lib/sessions'
import { PanelTabBar } from '@/components/artifact/PanelTabBar'
import { PanelToggle } from '@/components/layout/PanelToggle'
import { titlebarIconBtnClass } from '@/components/layout/titlebarChrome'
import { TerminalFilesPanel } from './TerminalFilesPanel'
import { TerminalAgentPanel } from './TerminalAgentPanel'
import type { TerminalFileTreeBackend } from './TerminalFileTree'

function pathBasename(p?: string): string {
  if (!p) return ''
  return p.replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? p
}

/**
 * Managed-terminal right rail: shared titlebar chrome
 * (`[Context Slot | Tab▾ | Collapse]`, stage-gate titlebar spec) + files/agent bodies.
 */
export function TerminalRightPanel({
  terminalId,
  backend,
  localRoot,
  remotePath,
}: {
  terminalId: string
  backend: TerminalFileTreeBackend
  localRoot?: string
  remotePath?: string
}) {
  const { t } = useTranslation()
  const tab = useUiStore((s) => (s.activeTerminalPanelTab ?? {})[terminalId] ?? 'files')
  const term = useManagedTerminalStore((s) =>
    s.terminals.find((x) => x.id === terminalId),
  )
  const activeSessionId = useTerminalAgentStore((s) => s.activeSessionByTerminal[terminalId])
  const activeSession = useDomainStore((s) =>
    activeSessionId ? s.sessions.find((x) => x.id === activeSessionId) : undefined,
  )
  const running =
    activeSession?.status === 'running' && isTerminalSession(activeSession.config)

  const isSsh = term?.kind === 'ssh'
  const agentLabel = activeSession?.config.agentId
    ? activeSession.config.agentId === 'builtin'
      ? t('terminals.agent.emptyTitle')
      : activeSession.config.agentId
    : t('terminals.agent.emptyTitle')
  const filesIdentity = backend === 'local'
    ? pathBasename(localRoot) || t('terminals.localFs.panelTitle')
    : pathBasename(remotePath) || (isSsh ? t('terminals.kindSsh') : t('terminals.filesPanel'))

  return (
    <div
      className="flex h-full min-h-0 flex-col border-l border-border bg-surface"
      data-testid="terminal-right-panel"
      data-tab={tab}
    >
      <div
        data-tauri-drag-region
        className="flex h-[var(--titlebar-height)] shrink-0 items-center justify-between gap-1 border-b border-border px-2"
      >
        {/* Context Slot */}
        <div
          className="flex min-w-0 flex-1 items-center gap-0.5"
          data-tauri-drag-region="false"
          data-testid="panel-context-slot"
        >
          {tab === 'agent' && isSsh ? (
            <>
              {running ? (
                <button
                  type="button"
                  className={titlebarIconBtnClass}
                  onClick={() => activeSessionId && sessionService.cancelSessionTurn(activeSessionId)}
                  title={t('terminals.agent.stop')}
                  data-testid="terminal-agent-stop"
                >
                  <Square size={13} strokeWidth={1.75} />
                </button>
              ) : null}
              <span
                className="min-w-0 max-w-[12rem] truncate px-1.5 text-meta text-ink-secondary"
                data-testid="slot-terminal-agent-identity"
              >
                {agentLabel}
                {running ? ` · ${t('terminals.agent.running')}` : ''}
              </span>
            </>
          ) : (
            <span
              className="min-w-0 max-w-[12rem] truncate px-1.5 text-meta text-ink-secondary"
              data-testid="slot-terminal-files-identity"
            >
              {filesIdentity}
            </span>
          )}
        </div>

        {/* Tab▾ — local terminals have no dropdown (titlebar spec §5). */}
        {isSsh ? <PanelTabBar surface="terminals" /> : null}
        <PanelToggle slot="panel" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'agent' && isSsh ? (
          <TerminalAgentPanel terminalId={terminalId} />
        ) : (
          <TerminalFilesPanel
            terminalId={terminalId}
            backend={backend}
            localRoot={localRoot}
            remotePath={remotePath}
            embedded
          />
        )}
      </div>
    </div>
  )
}
