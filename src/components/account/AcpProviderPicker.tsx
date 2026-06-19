import { useTranslation } from 'react-i18next'
import { Code, Bot, Cpu, Rocket, type LucideIcon } from 'lucide-react'
import { ACP_PRESETS, type AcpPreset, type AcpPresetIcon } from '@/lib/acpPresets'

const ICONS: Record<AcpPresetIcon, LucideIcon> = { code: Code, bot: Bot, cpu: Cpu, rocket: Rocket }

/** Step 1 of adding a new ACP agent: choose one of the supported provider presets.
 *  Custom/generic ACP agents are intentionally not offered — only the named providers. */
export function AcpProviderPicker({ onPick }: { onPick: (preset: AcpPreset) => void }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {ACP_PRESETS.map((preset) => {
        const Icon = ICONS[preset.icon]
        return (
          <div
            key={preset.id}
            role="button"
            tabIndex={0}
            onClick={() => onPick(preset)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(preset) } }}
            className="cursor-pointer rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-accent hover:bg-accent-subtle"
          >
            <div className="flex items-center gap-2">
              <Icon size={18} className="text-accent-strong" />
              <span className="text-body font-medium text-ink">{preset.name}</span>
            </div>
            <div className="mt-1.5 text-caption text-ink-tertiary">{t('settings.agents.acpPresetInstallHint', { cmd: preset.installCmd })}</div>
          </div>
        )
      })}
    </div>
  )
}
