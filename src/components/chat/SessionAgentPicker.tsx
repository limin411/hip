import { useTranslation } from 'react-i18next'
import { Bot, Check } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/DropdownMenu'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useAgents } from '@/store/hipConfigStore'
import { useActiveSession, useActiveSessionId } from '@/domain'
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

/**
 * Composer chip: pick the primary agent for a **new** (draft) session.
 * Builtin hip graph vs enabled ACP agents. Mid-session switch is PR-6b — locked read-only here.
 */
export function SessionAgentPicker() {
  const { t } = useTranslation()
  const agents = useAgents()
  const draft = useDraftStore((s) => s.draft)
  const setAgentId = useDraftStore((s) => s.setAgentId)
  const activeId = useActiveSessionId()
  const session = useActiveSession()

  const enabled = enabledAcpAgents(agents)

  // Any active session id: read-only badge (no mid-switch in PR-6a), even if row is briefly missing.
  if (activeId) {
    const aid = resolvePrimaryAgentId(session?.config.agentId)
    const isExternal = aid !== 'builtin'
    const name = isExternal
      ? (agents.find((a) => a.id === aid)?.name ?? aid)
      : t('composer.agentPicker.builtin')
    return (
      <ComposerChip
        disabled
        active={isExternal}
        title={t('composer.agentPicker.label')}
        data-testid="session-agent-chip-locked"
      >
        <Bot size={13} className="shrink-0" aria-hidden />
        <span className="max-w-[120px] truncate">{name}</span>
      </ComposerChip>
    )
  }

  const currentId = resolvePrimaryAgentId(draft?.agentId)
  // If the selected ACP agent was removed/disabled, fall back to label from id.
  const currentName =
    currentId === 'builtin'
      ? t('composer.agentPicker.builtin')
      : (enabled.find((a) => a.id === currentId)?.name
          ?? agents.find((a) => a.id === currentId)?.name
          ?? currentId)

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <ComposerChip
          active={currentId !== 'builtin'}
          title={t('composer.agentPicker.label')}
          data-testid="session-agent-chip"
        >
          <Bot size={13} className="shrink-0" aria-hidden />
          <span className="max-w-[120px] truncate">{currentName}</span>
        </ComposerChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid="session-agent-menu">
        <DropdownMenuItem
          onSelect={() => setAgentId('builtin')}
          data-testid="session-agent-option-builtin"
        >
          <Check size={14} className={cn('shrink-0', currentId === 'builtin' ? 'opacity-100' : 'opacity-0')} />
          <span>{t('composer.agentPicker.builtin')}</span>
        </DropdownMenuItem>
        {enabled.map((a) => (
          <DropdownMenuItem
            key={a.id}
            onSelect={() => setAgentId(a.id)}
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
  )
}
