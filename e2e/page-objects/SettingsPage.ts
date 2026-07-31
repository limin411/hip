export class SettingsPage {
  get settingsButton() { return browser.$('[data-testid="account-settings-button"]') }
  /** Settings main-column body (replaces former overlay shell). */
  get shell() { return browser.$('[data-testid="settings-page"]') }
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
  /** Leave Settings via sidebar back control. */
  get backButton() { return browser.$('[data-testid="settings-sidebar-back"]') }
  get activeTabPanel() { return browser.$('[role="tabpanel"][data-state="active"]') }
}
