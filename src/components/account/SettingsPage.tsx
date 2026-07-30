import { SettingsPanel } from './SettingsPanel'

/**
 * Settings body — shell Modal owns the title when shown as overlay.
 */
export function SettingsPage() {
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col bg-surface"
      data-testid="settings-page"
    >
      <SettingsPanel />
    </div>
  )
}
