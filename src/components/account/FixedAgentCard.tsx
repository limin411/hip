import { useTranslation } from 'react-i18next'
import { Lock, Cpu } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Switch } from '@/components/ui/Switch'

interface FixedAgentCardProps {
  agent: AgentConfig
  enabled: boolean
  onToggle: (enabled: boolean) => void
}

export function FixedAgentCard({ agent, enabled, onToggle }: FixedAgentCardProps) {
  const { t } = useTranslation()

  // Look up the description from i18n using the agent id; fall back to agent.description.
  const descKey = `settings.agents.fixed${agent.id.charAt(0).toUpperCase() + agent.id.slice(1)}Desc`
  const description = t(descKey, { defaultValue: agent.description })

  return (
    <div className="flex items-center gap-3.5 rounded-lg border border-border bg-surface-subtle px-4 py-3.5">
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-accent text-white">
        <Avatar name={agent.name} shape="square" size={38} />
      </span>

      <div className={cn('flex min-w-0 flex-1 items-center gap-3.5 transition-opacity', !enabled && 'opacity-60')}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body font-medium text-ink">{agent.name}</span>
            <Badge className="bg-accent-subtle text-accent-strong">
              {t('settings.agents.builtin')}
            </Badge>
            <Badge>
              <Cpu size={11} />
              {t('settings.agents.badgeGlobalModel')}
            </Badge>
          </div>
          {description && (
            <div className="mt-1 truncate text-caption text-ink-tertiary">
              {description}
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          ariaLabel={t('settings.agents.enableThis')}
        />
        <Lock size={15} className="shrink-0 text-ink-tertiary" />
      </div>
    </div>
  )
}
