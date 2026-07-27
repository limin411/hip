import { useTranslation } from 'react-i18next'
import { VoiceSettingsSection } from './VoiceSettingsSection'

/**
 * Settings → Basic → Voice (standalone page).
 * Model download + status check live in VoiceSettingsSection.
 */
export function VoiceSettings() {
  const { t } = useTranslation()
  return (
    // pb-20: long page (models + URLs + shortcut) scrolls inside SettingsPanel;
    // without bottom pad the last rows sit flush / feel clipped against the pane edge.
    <div className="flex flex-col pb-20" data-testid="settings-page-voice">
      <div className="px-8 pb-1 pt-7">
        <h2 className="text-title font-semibold tracking-tight text-ink">{t('settings.voicePage')}</h2>
        <p className="mt-1 text-meta leading-relaxed text-ink-tertiary">
          {t('settings.voicePageDesc')}
        </p>
      </div>
      {/* Section already has its own h3; hide duplicate section title chrome via section key still used inside */}
      <VoiceSettingsSection hideOuterHeading />
    </div>
  )
}
