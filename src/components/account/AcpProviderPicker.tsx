import { useTranslation } from 'react-i18next'
import { Code, Bot, Cpu, Rocket, CircleCheck, Check, RefreshCw, type LucideIcon } from 'lucide-react'
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
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onRefresh}
          className="flex items-center gap-1.5 text-meta text-ink-secondary transition-colors hover:text-ink"
        >
          <RefreshCw size={13} /> {t('settings.agents.redetect')}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
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
              onKeyDown={pickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(preset) } } : undefined}
              className={cn(
                'rounded-lg border px-3 py-2.5 transition-colors',
                pickable ? 'cursor-pointer border-border hover:border-accent hover:bg-accent-subtle' : 'border-border opacity-80',
              )}
            >
              <div className="flex items-center gap-2">
                <Icon size={18} className={ready ? 'text-accent-strong' : 'text-ink-tertiary'} />
                <span className={cn('text-body font-medium', ready ? 'text-ink' : 'text-ink-secondary')}>{preset.name}</span>
              </div>
              {checked && (added ? (
                <div className="mt-1.5 flex items-center gap-1 text-caption text-ink-secondary">
                  <Check size={13} /> {t('settings.agents.statusAdded')}
                </div>
              ) : ready ? (
                <div className="mt-1.5 flex items-center gap-1 text-caption text-success">
                  <CircleCheck size={13} /> {t('settings.agents.statusInstalled')}
                </div>
              ) : (
                <div className="mt-1.5 space-y-1.5">
                  {!agentOk && (
                    <div className="space-y-1">
                      <div className="text-caption text-ink-tertiary">{t('settings.agents.statusNotInstalled')}</div>
                      <code className="block select-all rounded bg-surface-muted px-1.5 py-1 font-mono text-caption text-ink-secondary">
                        {preset.installCmd}
                      </code>
                    </div>
                  )}
                  {preset.adapterBin && !adapterOk && (
                    <div className="space-y-1">
                      <div className="text-caption text-ink-tertiary">{t('settings.agents.statusAdapterNotInstalled')}</div>
                      {preset.adapterInstallCmd && (
                        <code className="block select-all rounded bg-surface-muted px-1.5 py-1 font-mono text-caption text-ink-secondary">
                          {preset.adapterInstallCmd}
                        </code>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {preset.adapterPkg && (
                <div className="mt-1.5 text-caption text-ink-tertiary">
                  {t('settings.agents.acpAdapterNote', { pkg: preset.adapterPkg })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
