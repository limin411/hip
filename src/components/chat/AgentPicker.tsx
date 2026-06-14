import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Check, Lock } from 'lucide-react'
import { useActiveSession, useActiveSessionId } from '@/domain'
import { useDraftStore } from '@/store/draftStore'
import { useAgentsStore } from '@/store/agentsStore'
import { useProvidersStore } from '@/store/providersStore'
import { cn } from '@/lib/utils'
import { ComposerChip } from './ComposerChip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/DropdownMenu'

export function AgentPicker() {
  const { t } = useTranslation()
  const activeId = useActiveSessionId()
  const session = useActiveSession()
  const agents = useAgentsStore((s) => s.agents)
  const loaded = useAgentsStore((s) => s.loaded)
  const load = useAgentsStore((s) => s.load)
  const draft = useDraftStore((s) => s.draft)
  const setAgentId = useDraftStore((s) => s.setAgentId)
  const config = useProvidersStore((s) => s.config)

  useEffect(() => { if (!loaded) void load() }, [loaded, load])

  // Committed session: locked read-only badge, only for external agents.
  if (activeId && session) {
    const aid = session.config.agentId
    if (!aid || aid === 'builtin') return null
    const name = agents.find((a) => a.id === aid)?.name ?? aid
    return (
      <ComposerChip disabled active title={t('chat.agentLocked')} data-testid="agent-chip-locked">
        <Bot size={13} className="shrink-0" aria-hidden />
        <span className="max-w-[120px] truncate">{name}</span>
        <Lock size={11} className="shrink-0 opacity-60" aria-hidden />
      </ComposerChip>
    )
  }

  // Draft: interactive picker (built-in + enabled external agents).
  const enabled = agents.filter((a) => a.enabled)
  const currentId = draft?.agentId ?? 'builtin'
  const currentName =
    currentId === 'builtin'
      ? t('chat.agentBuiltin')
      : (enabled.find((a) => a.id === currentId)?.name ?? t('chat.agentBuiltin'))

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <ComposerChip active={currentId !== 'builtin'} title={t('chat.agentHint')} data-testid="agent-chip">
          <Bot size={13} className="shrink-0" aria-hidden />
          <span className="max-w-[120px] truncate">{currentName}</span>
        </ComposerChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => setAgentId('builtin')}>
          <Check size={14} className={cn('shrink-0', currentId === 'builtin' ? 'opacity-100' : 'opacity-0')} />
          <span>{t('chat.agentBuiltin')}</span>
        </DropdownMenuItem>
        {enabled.map((a) => {
          const ready =
            !a.acceptsModelConfig ||
            (!!a.boundModel && !!config.providers[a.boundModel.providerID]?.enabled)
          return (
            <DropdownMenuItem key={a.id} disabled={!ready} onSelect={() => { if (ready) setAgentId(a.id) }}>
              <Check size={14} className={cn('shrink-0', currentId === a.id ? 'opacity-100' : 'opacity-0')} />
              <span className="truncate">{a.name}</span>
              {ready
                ? (a.boundModel && <span className="ml-2 text-meta text-ink-tertiary">{a.boundModel.modelID}</span>)
                : <span className="ml-2 text-meta text-ink-tertiary">{t('chat.agentNeedsModel')}</span>}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
