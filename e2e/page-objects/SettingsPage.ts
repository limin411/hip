export class SettingsPage {
  get settingsButton() { return browser.$('[data-testid="account-settings-button"]') }
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
      | 'about',
  ) {
    return browser.$(`[data-testid="settings-nav-${page}"]`)
  }
  // Settings uses the shared titlebar back control (not a settings-local button).
  get backButton() { return browser.$('[data-testid="titlebar-back"]') }
  get activeTabPanel() { return browser.$('[role="tabpanel"][data-state="active"]') }
}
