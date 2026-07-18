import { useTranslation } from 'react-i18next'
import { Cpu, Terminal, Pencil, Trash2, MoreVertical, CircleCheck, AlertCircle } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { agentCategory } from '@/lib/agentCategory'
import { agentCommandLine } from '@/lib/agentCommandLine'
import { agentBinaryStatus } from '@/lib/acpPresets'
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
import { DeclarativeContextMenu } from '@/components/context-menu'

export function AgentCard({
  agent,
  viewMode = 'list',
  installed = {},
  detectionChecked = false,
  onToggle,
  onEdit,
  onDelete,
}: {
  agent: AgentConfig
  viewMode?: 'grid' | 'list'
  installed?: Record<string, boolean>
  detectionChecked?: boolean
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const cat = agentCategory(agent)
  const catLabel = cat === 'acp' ? t('settings.agents.catAcp') : t('settings.agents.badgeInternal')
  const cmdline = agentCommandLine(agent)
  const binaryStatus = detectionChecked ? agentBinaryStatus(agent, installed) : undefined
  const missingBinary = binaryStatus && !binaryStatus.installed
  const switchChecked = agent.enabled && !missingBinary
  const switchDisabled = !!missingBinary

  const menuPayload = { agentId: agent.id, onEdit, onDelete }

  if (viewMode === 'grid') {
    // Card chrome on permanent outer so CONTEXT_MENUS=false keeps layout.
    return (
      <div
        data-testid="agent-card"
        className="relative flex min-h-[160px] flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-subtle"
      >
        <DeclarativeContextMenu
          kind="agentConfig"
          payload={menuPayload}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className={cn('flex flex-1 flex-col transition-opacity', !switchChecked && 'opacity-60')}>
            <div className="flex items-start gap-3">
              <Avatar name={agent.name} shape="square" size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-medium text-ink">{agent.name}</div>
                <Badge
                  variant={cat === 'internal' ? 'accent' : 'default'}
                  className="mt-1"
                >
                  {catLabel}
                </Badge>
              </div>
            </div>
            <div className="mt-3 flex-1">
              <p className="line-clamp-2 text-body text-ink-secondary">
                {agent.description || (
                  <span className="font-mono text-ink-tertiary">{cmdline}</span>
                )}
              </p>
              {missingBinary && binaryStatus && (
                <MissingInstallHints status={binaryStatus} />
              )}
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <Switch
              checked={switchChecked}
              disabled={switchDisabled}
              onCheckedChange={onToggle}
              ariaLabel={t('settings.agents.enableThis')}
            />
            <div className="flex items-center gap-1 opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100">
              <ActionButton icon={<Pencil size={14} />} label={t('settings.agents.edit')} onClick={onEdit} />
              <ActionButton icon={<Trash2 size={14} />} label={t('settings.agents.delete')} onClick={onDelete} danger />
            </div>
          </div>
        </DeclarativeContextMenu>
      </div>
    )
  }

  return (
    <div
      data-testid="agent-card"
      className="flex items-center gap-3.5 rounded-lg border border-border bg-surface px-4 py-3.5"
    >
      <DeclarativeContextMenu
        kind="agentConfig"
        payload={menuPayload}
        className="flex min-w-0 flex-1 items-center gap-3.5"
      >
        <div className={cn('flex min-w-0 flex-1 items-center gap-3.5 transition-opacity', !switchChecked && 'opacity-60')}>
          <Avatar name={agent.name} shape="square" size={38} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body font-medium text-ink">{agent.name}</span>
              <Badge variant={cat === 'internal' ? 'accent' : 'default'}>{catLabel}</Badge>

              {cat === 'internal' && (
                <Badge>
                  <Cpu size={11} />
                  {agent.boundModel ? agent.boundModel.modelID : t('settings.agents.badgeGlobalModel')}
                </Badge>
              )}
              {binaryStatus && (
                <Badge
                  className={
                    binaryStatus.installed
                      ? 'bg-success/10 text-success'
                      : 'bg-danger/10 text-danger'
                  }
                >
                  {binaryStatus.installed ? (
                    <>
                      <CircleCheck size={11} />
                      {t('settings.agents.statusInstalled')}
                    </>
                  ) : !binaryStatus.agentInstalled ? (
                    <>
                      <AlertCircle size={11} />
                      {t('settings.agents.statusNotInstalled')}
                    </>
                  ) : (
                    <>
                      <AlertCircle size={11} />
                      {t('settings.agents.statusAdapterNotInstalled')}
                    </>
                  )}
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
                {missingBinary && binaryStatus && (
                  <MissingInstallHints status={binaryStatus} compact />
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <Switch
            checked={switchChecked}
            disabled={switchDisabled}
            onCheckedChange={onToggle}
            ariaLabel={t('settings.agents.enableThis')}
          />
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
      </DeclarativeContextMenu>
    </div>
  )
}

function MissingInstallHints({
  status,
  compact,
}: {
  status: NonNullable<ReturnType<typeof agentBinaryStatus>>
  compact?: boolean
}) {
  const { t } = useTranslation()
  const { preset, agentInstalled, adapterInstalled } = status
  return (
    <div className={cn('space-y-1', compact ? 'mt-1.5' : 'mt-2')}>
      {!agentInstalled && (
        <>
          <div className="flex items-center gap-1 text-caption text-danger">
            <AlertCircle size={12} />
            {t('settings.agents.statusNotInstalled')}
          </div>
          {preset.installCmd && (
            <code className="block select-all rounded bg-surface-muted px-1.5 py-1 font-mono text-caption text-ink-secondary">
              {preset.installCmd}
            </code>
          )}
        </>
      )}
      {!adapterInstalled && preset.adapterBin && (
        <>
          <div className="flex items-center gap-1 text-caption text-danger">
            <AlertCircle size={12} />
            {t('settings.agents.statusAdapterNotInstalled')}
          </div>
          {preset.adapterInstallCmd && (
            <code className="block select-all rounded bg-surface-muted px-1.5 py-1 font-mono text-caption text-ink-secondary">
              {preset.adapterInstallCmd}
            </code>
          )}
        </>
      )}
    </div>
  )
}

function ActionButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        danger
          ? 'text-ink-secondary hover:bg-danger/10 hover:text-danger'
          : 'text-ink-secondary hover:bg-surface-muted hover:text-ink',
      )}
      aria-label={label}
    >
      {icon}
    </button>
  )
}
