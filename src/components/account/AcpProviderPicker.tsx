import { useTranslation } from 'react-i18next'
import {
  Code,
  Bot,
  Cpu,
  Rocket,
  Sparkles,
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

const ICONS: Record<AcpPresetIcon, LucideIcon> = {
  code: Code,
  bot: Bot,
  cpu: Cpu,
  rocket: Rocket,
  sparkles: Sparkles,
}

/** Step 1 of adding a new ACP agent: choose one of the supported provider presets.
 *  Only fully-ready (agent + adapter when required) and unadded presets are pickable;
 *  missing agent/adapter show compact install commands. Custom/generic ACP agents are not offered. */
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
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
          )}
        >
          <RefreshCw size={13} className={cn(!checked && 'animate-spin')} />
          {t('settings.agents.redetect')}
        </button>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {ACP_PRESETS.map((preset) => {
          const Icon = ICONS[preset.icon]
          const agentOk = presetAgentInstalled(preset, installed)
          const adapterOk = presetAdapterInstalled(preset, installed)
          const ready = presetInstalled(preset, installed)
          const added = presetAdded(preset, agents)
          const pickable = checked && ready && !added
          const needsInstall = checked && !added && !ready
          const installLines: string[] = []
          if (needsInstall && !agentOk && preset.installCmd) installLines.push(preset.installCmd)
          if (needsInstall && preset.adapterBin && !adapterOk && preset.adapterInstallCmd) {
            installLines.push(preset.adapterInstallCmd)
          }

          return (
            <li key={preset.id}>
              <div
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
                  'group px-3 py-2.5 transition-colors duration-150',
                  pickable && [
                    'cursor-pointer',
                    'hover:bg-state-hover',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                  ],
                  !pickable && 'bg-surface-subtle/30',
                  added && 'opacity-90',
                  !checked && 'opacity-70',
                )}
              >
                {/* Primary row: icon · name/desc · status · chevron */}
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                      pickable
                        ? 'bg-accent-subtle text-accent-strong group-hover:bg-accent/15'
                        : ready || added
                          ? 'bg-surface-muted text-ink-secondary'
                          : 'bg-surface-muted text-ink-tertiary',
                    )}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={cn(
                          'truncate text-body font-medium tracking-tight',
                          pickable || ready || added ? 'text-ink' : 'text-ink-secondary',
                        )}
                      >
                        {preset.name}
                      </span>
                      {preset.adapterPkg && (
                        <Badge size="sm" className="shrink-0 font-normal" title={preset.adapterPkg}>
                          <Plug size={10} />
                          ACP
                        </Badge>
                      )}
                    </div>
                    {preset.adapterPkg && (
                      <p className="mt-0.5 text-caption leading-snug text-ink-tertiary">
                        {t('settings.agents.acpAdapterNote', { pkg: preset.adapterPkg })}
                      </p>
                    )}
                    {installLines.length > 0 && (
                      <div className="mt-1.5 space-y-0.5">
                        {installLines.map((cmd) => (
                          <code
                            key={cmd}
                            className="block select-all break-all font-mono text-caption leading-snug text-ink-tertiary"
                          >
                            {cmd}
                          </code>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 self-center">
                    {!checked ? (
                      <span className="text-caption text-ink-tertiary">
                        {t('settings.agents.acpPickDetecting')}
                      </span>
                    ) : added ? (
                      <StatusPill tone="muted" icon={Check} label={t('settings.agents.statusAdded')} />
                    ) : ready ? (
                      <StatusPill
                        tone="success"
                        icon={CircleCheck}
                        label={t('settings.agents.statusInstalled')}
                      />
                    ) : !agentOk ? (
                      <StatusPill
                        tone="danger"
                        icon={AlertCircle}
                        label={t('settings.agents.statusNotInstalled')}
                      />
                    ) : (
                      <StatusPill
                        tone="danger"
                        icon={AlertCircle}
                        label={t('settings.agents.statusAdapterNotInstalled')}
                      />
                    )}
                    {pickable && (
                      <ChevronRight
                        size={16}
                        className="text-ink-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-accent-strong"
                      />
                    )}
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
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
        'inline-flex max-w-[9.5rem] items-center gap-1 truncate rounded-full px-2 py-0.5 text-caption font-medium',
        tone === 'success' && 'bg-success/10 text-success',
        tone === 'danger' && 'bg-danger/10 text-danger',
        tone === 'muted' && 'bg-surface-muted text-ink-secondary',
      )}
    >
      <Icon size={12} className="shrink-0" strokeWidth={1.75} />
      <span className="truncate">{label}</span>
    </span>
  )
}
