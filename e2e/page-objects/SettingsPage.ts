export class SettingsPage {
  get accountMenuButton() { return browser.$('[data-testid="account-menu-button"]') }
  get settingsMenuItem() { return browser.$('[data-testid="account-settings-menu-item"]') }
  nav(page: 'general' | 'model' | 'agents' | 'mcp' | 'skill' | 'plugins' | 'memory') {
    return browser.$(`[data-testid="settings-nav-${page}"]`)
  }
  get backButton() { return browser.$('[data-testid="settings-back"]') }
  get activeTabPanel() { return browser.$('[role="tabpanel"][data-state="active"]') }
}
