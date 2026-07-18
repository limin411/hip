import { useTranslation } from 'react-i18next'
import {
  Code,
  Bot,
  Cpu,
  Rocket,
  CircleCheck,
  Check,
  RefreshCw,
  ChevronRight,
  AlertCircle,
  Plug,
  type LucideIcon,
} from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import {
  ACP_PRESETS,
  presetInstalled,
  presetAgentInstalled,
  presetAdapterInstalled,
  presetAdded,
  type AcpPreset,
  type AcpPresetIcon,
} from '@/lib/acpPresets'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'

const ICONS: Record<AcpPresetIcon, LucideIcon> = { code: Code, bot: Bot, cpu: Cpu, rocket: Rocket }

/** Step 1 of adding a new ACP agent: choose one of the supported provider presets.
 *  Only fully-ready (agent + adapter when required) and unadded presets are pickable;
 *  missing agent/adapter show install hints. Custom/generic ACP agents are not offered. */
export function AcpProviderPicker({
  checked,
  installed,
  agents,
  onPick,
  onRefresh,
}: {
  checked: boolean
  installed: Record<string, boolean>
  agents: AgentConfig[]
  onPick: (preset: AcpPreset) => void
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-[34rem] text-body leading-relaxed text-ink-secondary">
          {t('settings.agents.acpPickIntro')}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5',
            'text-meta text-ink-secondary transition-colors',
            'hover:border-accent/40 hover:bg-state-hover hover:text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          )}
        >
          <RefreshCw size={13} className={cn(!checked && 'animate-spin')} />
          {t('settings.agents.redetect')}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ACP_PRESETS.map((preset) => {
          const Icon = ICONS[preset.icon]
          const agentOk = presetAgentInstalled(preset, installed)
          const adapterOk = presetAdapterInstalled(preset, installed)
          const ready = presetInstalled(preset, installed)
          const added = presetAdded(preset, agents)
          const pickable = checked && ready && !added

          return (
            <div
              key={preset.id}
              role={pickable ? 'button' : undefined}
              tabIndex={pickable ? 0 : undefined}
              onClick={pickable ? () => onPick(preset) : undefined}
              onKeyDown={
                pickable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onPick(preset)
                      }
                    }
                  : undefined
              }
              className={cn(
                'group relative flex flex-col rounded-xl border bg-surface p-3.5 transition-all duration-150',
                pickable && [
                  'cursor-pointer border-border',
                  'hover:border-accent/50 hover:bg-accent-subtle/60',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                  'active:scale-[0.99]',
                ],
                !pickable && 'border-border/80 bg-surface-subtle/40',
                added && 'opacity-90',
                !checked && 'opacity-70',
              )}
            >
              {/* Header: icon + name + status / chevron */}
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors',
                    pickable
                      ? 'bg-accent-subtle text-accent-strong group-hover:bg-accent/15'
                      : ready || added
                        ? 'bg-surface-muted text-ink-secondary'
                        : 'bg-surface-muted text-ink-tertiary',
                  )}
                >
                  <Icon size={20} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'truncate text-body font-semibold tracking-tight',
                        pickable || ready || added ? 'text-ink' : 'text-ink-secondary',
                      )}
                    >
                      {preset.name}
                    </span>
                    {preset.adapterPkg && (
                      <Badge size="sm" className="shrink-0 font-normal">
                        <Plug size={10} />
                        ACP
                      </Badge>
                    )}
                  </div>
                  {checked && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {added ? (
                        <StatusPill tone="muted" icon={Check} label={t('settings.agents.statusAdded')} />
                      ) : ready ? (
                        <StatusPill tone="success" icon={CircleCheck} label={t('settings.agents.statusInstalled')} />
                      ) : (
                        <>
                          {!agentOk && (
                            <StatusPill tone="danger" icon={AlertCircle} label={t('settings.agents.statusNotInstalled')} />
                          )}
                          {agentOk && preset.adapterBin && !adapterOk && (
                            <StatusPill tone="danger" icon={AlertCircle} label={t('settings.agents.statusAdapterNotInstalled')} />
                          )}
                          {!agentOk && preset.adapterBin && !adapterOk && (
                            <StatusPill tone="danger" icon={AlertCircle} label={t('settings.agents.statusAdapterNotInstalled')} />
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {!checked && (
                    <div className="mt-1.5 text-caption text-ink-tertiary">{t('settings.agents.acpPickDetecting')}</div>
                  )}
                </div>
                {pickable && (
                  <ChevronRight
                    size={16}
                    className="mt-1 shrink-0 text-ink-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-accent-strong"
                  />
                )}
              </div>

              {/* Install hints when not ready */}
              {checked && !added && !ready && (
                <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
                  {!agentOk && (
                    <InstallHint
                      label={t('settings.agents.statusNotInstalled')}
                      command={preset.installCmd}
                    />
                  )}
                  {preset.adapterBin && !adapterOk && (
                    <InstallHint
                      label={t('settings.agents.statusAdapterNotInstalled')}
                      command={preset.adapterInstallCmd ?? ''}
                    />
                  )}
                </div>
              )}

              {/* Adapter footnote (when ready or added — still useful context) */}
              {preset.adapterPkg && (ready || added) && (
                <p className="mt-3 border-t border-border/60 pt-2.5 text-caption leading-snug text-ink-tertiary">
                  {t('settings.agents.acpAdapterNote', { pkg: preset.adapterPkg })}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatusPill({
  tone,
  icon: Icon,
  label,
}: {
  tone: 'success' | 'danger' | 'muted'
  icon: LucideIcon
  label: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium',
        tone === 'success' && 'bg-success/10 text-success',
        tone === 'danger' && 'bg-danger/10 text-danger',
        tone === 'muted' && 'bg-surface-muted text-ink-secondary',
      )}
    >
      <Icon size={12} strokeWidth={2.25} />
      {label}
    </span>
  )
}

function InstallHint({ label, command }: { label: string; command: string }) {
  if (!command) return null
  return (
    <div className="rounded-lg border border-border/80 bg-surface px-2.5 py-2">
      <div className="mb-1 flex items-center gap-1 text-caption font-medium text-ink-secondary">
        <AlertCircle size={11} className="text-danger" />
        {label}
      </div>
      <code className="block select-all break-all rounded-md bg-surface-muted px-2 py-1.5 font-mono text-caption leading-snug text-ink-secondary">
        {command}
      </code>
    </div>
  )
}
