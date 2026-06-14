import { useTranslation } from 'react-i18next'
import { SettingsPanel } from './SettingsPanel'

export function SettingsPage() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col bg-surface">
      <div
        data-tauri-drag-region
        className="flex h-11 shrink-0 items-center border-b border-border px-5"
      >
        <span className="text-body font-medium text-ink">{t('settings.title')}</span>
      </div>
      <div className="min-h-0 flex-1">
        <SettingsPanel />
      </div>
    </div>
  )
}
