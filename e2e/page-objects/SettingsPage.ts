export class SettingsPage {
  get settingsButton() { return browser.$('[data-testid="account-settings-button"]') }
  get shell() { return browser.$('[data-testid="overlay-shell-settings"]') }
  nav(
    page:
      | 'general'
      | 'model'
      | 'agents'
      | 'mcp'
      | 'skill'
      | 'plugins'
      | 'memory'
      | 'voice'
      | 'usage'
      | 'network'
      | 'about'
      | 'window'
      | 'connectors'
      | 'hooks',
  ) {
    return browser.$(`[data-testid="settings-nav-${page}"]`)
  }
  /** Prefer shell modal-close; legacy titlebar-back may be absent. */
  get backButton() { return browser.$('[data-testid="modal-close"]') }
  get activeTabPanel() { return browser.$('[role="tabpanel"][data-state="active"]') }
}
