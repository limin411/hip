import { useTranslation } from 'react-i18next'
import { Code, Bot, Cpu, Rocket, CircleCheck, type LucideIcon } from 'lucide-react'
import { ACP_PRESETS, type AcpPreset, type AcpPresetIcon } from '@/lib/acpPresets'
import { cn } from '@/lib/utils'

const ICONS: Record<AcpPresetIcon, LucideIcon> = { code: Code, bot: Bot, cpu: Cpu, rocket: Rocket }

/** Step 1 of adding a new ACP agent: choose one of the supported provider presets.
 *  Custom/generic ACP agents are intentionally not offered — only the named providers. */
export function AcpProviderPicker({ onPick }: { onPick: (preset: AcpPreset) => void }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {ACP_PRESETS.map((preset) => {
        const Icon = ICONS[preset.icon]
        const available = preset.status === 'available'
        return (
          <div
            key={preset.id}
            role={available ? 'button' : undefined}
            tabIndex={available ? 0 : undefined}
            onClick={available ? () => onPick(preset) : undefined}
            onKeyDown={available ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(preset) } } : undefined}
            className={cn(
              'rounded-lg border px-3 py-2.5 transition-colors',
              available ? 'cursor-pointer border-border hover:border-accent hover:bg-accent-subtle' : 'border-border opacity-70',
            )}
          >
            <div className="flex items-center gap-2">
              <Icon size={18} className={available ? 'text-accent-strong' : 'text-ink-tertiary'} />
              <span className={cn('text-body font-medium', available ? 'text-ink' : 'text-ink-secondary')}>{preset.name}</span>
            </div>
            {available ? (
              <div className="mt-1.5 flex items-center gap-1 text-caption text-success">
                <CircleCheck size={13} /> {t('settings.agents.acpPresetAvailable')}
              </div>
            ) : (
              <div className="mt-1.5 text-caption text-ink-tertiary">{t('settings.agents.acpPresetComingSoon')}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
