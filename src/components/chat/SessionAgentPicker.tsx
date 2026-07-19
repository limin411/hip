import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Check } from 'lucide-react'
import type { AgentConfig, SessionConfig } from '@hip/protocol'
import { normalizeSessionConfig } from '@hip/protocol'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/DropdownMenu'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useAgents } from '@/store/hipConfigStore'
import { sessionService, useActiveSession, useActiveSessionId } from '@/domain'
import { isAcpCapableAgent } from '@/lib/sessionAgent'
import { cn } from '@/lib/utils'

/** Enabled ACP-capable agents available as session primary (acp + legacy opencode). */
export function enabledAcpAgents(agents: AgentConfig[]): AgentConfig[] {
  return agents.filter((a) => isAcpCapableAgent(a))
}

/** Normalize draft/session agent id for display (empty → builtin). */
export function resolvePrimaryAgentId(agentId: string | undefined): string {
  const id = typeof agentId === 'string' ? agentId.trim() : ''
  return id || 'builtin'
}

function agentDisplayName(
  agentId: string,
  agents: AgentConfig[],
  enabled: AgentConfig[],
  builtinLabel: string,
): string {
  if (agentId === 'builtin') return builtinLabel
  return (
    enabled.find((a) => a.id === agentId)?.name
    ?? agents.find((a) => a.id === agentId)?.name
    ?? agentId
  )
}

/**
 * Composer chip: pick the primary agent for a draft or active session.
 * Draft: writes draft.agentId. Active: confirm dialog → setAgent mid-switch or new session.
 */
export function SessionAgentPicker() {
  const { t } = useTranslation()
  const agents = useAgents()
  const draft = useDraftStore((s) => s.draft)
  const setAgentId = useDraftStore((s) => s.setAgentId)
  const activeId = useActiveSessionId()
  const session = useActiveSession()
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null)

  const enabled = enabledAcpAgents(agents)
  const builtinLabel = t('composer.agentPicker.builtin')

  const currentId = activeId
    ? resolvePrimaryAgentId(session?.config.agentId)
    : resolvePrimaryAgentId(draft?.agentId)

  const currentName = agentDisplayName(currentId, agents, enabled, builtinLabel)

  const pendingName = pendingAgentId
    ? agentDisplayName(pendingAgentId, agents, enabled, builtinLabel)
    : ''

  const selectAgent = (nextId: string) => {
    const resolved = resolvePrimaryAgentId(nextId)
    if (resolved === currentId) return
    if (!activeId) {
      setAgentId(resolved)
      return
    }
    // Active session: confirm before mid-switch or forking a new session.
    setPendingAgentId(resolved)
  }

  const closeDialog = () => setPendingAgentId(null)

  const switchThisSession = () => {
    if (!activeId || !pendingAgentId) return
    sessionService.setAgent(activeId, pendingAgentId)
    closeDialog()
  }

  const openNewSession = () => {
    if (!pendingAgentId || !session) {
      closeDialog()
      return
    }
    const base: SessionConfig = { ...session.config }
    if (pendingAgentId === 'builtin') {
      delete base.agentId
    } else {
      base.agentId = pendingAgentId
      // Hip-only draft fields are not meaningful under external primary.
      delete base.forcePlan
    }
    sessionService.createSession(normalizeSessionConfig(base))
    closeDialog()
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <ComposerChip
            active={currentId !== 'builtin'}
            title={t('composer.agentPicker.label')}
            data-testid={activeId ? 'session-agent-chip-active' : 'session-agent-chip'}
          >
            <Bot size={13} className="shrink-0" aria-hidden />
            <span className="max-w-[120px] truncate">{currentName}</span>
          </ComposerChip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" data-testid="session-agent-menu">
          <DropdownMenuItem
            onSelect={() => selectAgent('builtin')}
            data-testid="session-agent-option-builtin"
          >
            <Check size={14} className={cn('shrink-0', currentId === 'builtin' ? 'opacity-100' : 'opacity-0')} />
            <span>{builtinLabel}</span>
          </DropdownMenuItem>
          {enabled.map((a) => (
            <DropdownMenuItem
              key={a.id}
              onSelect={() => selectAgent(a.id)}
              data-testid={`session-agent-option-${a.id}`}
            >
              <Check size={14} className={cn('shrink-0', currentId === a.id ? 'opacity-100' : 'opacity-0')} />
              <span className="truncate">{a.name}</span>
            </DropdownMenuItem>
          ))}
          {enabled.length === 0 && (
            <div
              className="px-2 py-1.5 text-meta text-ink-tertiary"
              data-testid="session-agent-empty"
            >
              {t('composer.agentPicker.empty')}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Modal
        open={pendingAgentId !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
        title={t('composer.agentSwitch.title')}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={closeDialog} data-testid="session-agent-switch-cancel">
              {t('composer.agentSwitch.cancel')}
            </Button>
            <Button variant="secondary" size="sm" onClick={openNewSession} data-testid="session-agent-switch-new">
              {t('composer.agentSwitch.newSession')}
            </Button>
            <Button variant="primary" size="sm" onClick={switchThisSession} data-testid="session-agent-switch-this">
              {t('composer.agentSwitch.thisSession')}
            </Button>
          </div>
        }
      >
        <div className="space-y-2 text-body text-ink-secondary" data-testid="session-agent-switch-dialog">
          <p>{t('composer.agentSwitch.target', { name: pendingName })}</p>
          <p>{t('composer.agentSwitch.body')}</p>
        </div>
      </Modal>
    </>
  )
}
