import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
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
  const description = t(descKey, { defaultValue: agent.description ?? '' })

  return (
    <div className="relative flex min-h-[160px] flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-subtle">
      <div className={cn('flex flex-1 flex-col transition-opacity', !enabled && 'opacity-60')}>
        <div className="flex items-start gap-3">
          <Avatar name={agent.name} shape="square" size={40} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-body font-medium text-ink">{agent.name}</div>
            <Badge variant="accent" className="mt-1">
              {t('settings.agents.builtin')}
            </Badge>
          </div>
        </div>
        <div className="mt-3 flex-1">
          <p className="line-clamp-2 text-body text-ink-secondary">
            {description}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
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
