import { useTranslation } from 'react-i18next'
import { Bot, Lock, Cpu, Terminal, Pencil, Trash2, MoreVertical } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { agentCategory } from '@/lib/agentCategory'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Switch } from '@/components/ui/Switch'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu'

/** Pinned, non-editable built-in agent. */
export function BuiltinCard() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3.5 rounded-lg border border-border bg-surface-subtle px-4 py-3.5">
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-accent text-white">
        <Bot size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-body font-medium text-ink">{t('settings.agents.builtinName')}</span>
          <Badge className="bg-accent-subtle text-accent-strong">{t('settings.agents.builtin')}</Badge>
        </div>
        <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.agents.builtinDesc')}</div>
      </div>
      <Lock size={15} className="shrink-0 text-ink-tertiary" />
    </div>
  )
}

export function AgentCard({
  agent,
  onToggle,
  onEdit,
  onDelete,
}: {
  agent: AgentConfig
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const cat = agentCategory(agent)
  const catLabel = cat === 'acp' ? t('settings.agents.catAcp') : cat === 'internal' ? t('settings.agents.badgeInternal') : t('settings.agents.catCli')
  const cmdline = [agent.command, ...agent.args].join(' ')
  return (
    <div className="flex items-center gap-3.5 rounded-lg border border-border bg-surface px-4 py-3.5">
      <Avatar name={agent.name} shape="square" size={38} className={cn(!agent.enabled && 'opacity-60')} />
      <div className={cn('min-w-0 flex-1', !agent.enabled && 'opacity-60')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-medium text-ink">{agent.name}</span>
          <Badge className={cat === 'internal' ? 'bg-accent-subtle text-accent-strong' : undefined}>{catLabel}</Badge>
          {cat !== 'internal' && (
            <Badge className={agent.transport === 'rich' ? 'bg-accent-subtle text-accent-strong' : undefined}>
              {t(agent.transport === 'rich' ? 'settings.agents.transportRich' : 'settings.agents.transportThin')}
            </Badge>
          )}
          {cat === 'internal' && (
            <Badge>
              <Cpu size={11} />
              {agent.boundModel ? agent.boundModel.modelID : t('settings.agents.badgeGlobalModel')}
            </Badge>
          )}
        </div>
        {cat === 'internal' ? (
          agent.description && <div className="mt-1 truncate text-caption text-ink-tertiary">{agent.description}</div>
        ) : (
          <>
            <div className="mt-1 flex items-center gap-1 overflow-hidden font-mono text-caption text-ink-tertiary">
              <Terminal size={12} className="shrink-0 text-ink-tertiary/70" />
              <span className="min-w-0 truncate">{cmdline}</span>
            </div>
            {agent.description && <div className="mt-1 truncate text-caption text-ink-tertiary">{agent.description}</div>}
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <Switch checked={agent.enabled} onCheckedChange={onToggle} ariaLabel={t('settings.agents.enableThis')} />
        {/* modal={false}: a modal menu + the dialog its items open both lock `body { pointer-events: none }`;
            stacking them leaves the lock stuck after the dialog closes (whole app unclickable). A kebab needs
            no scroll/focus trapping, so non-modal avoids the race for both 编辑 and 删除. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              aria-label={t('settings.agents.menuMore')}
            >
              <MoreVertical size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil size={14} /> {t('settings.agents.edit')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-danger focus:bg-danger/10" onSelect={onDelete}>
              <Trash2 size={14} /> {t('settings.agents.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
