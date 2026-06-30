export class SettingsPage {
  get accountFooter() { return browser.$('[data-testid="account-footer"]') }
  get settingsMenuItem() { return browser.$('[data-testid="settings-menu-item"]') }
  nav(page: 'general' | 'model' | 'agents' | 'mcp' | 'skill' | 'plugins') {
    return browser.$(`[data-testid="settings-nav-${page}"]`)
  }
  get backButton() { return browser.$('[data-testid="settings-back"]') }
  get activeTabPanel() { return browser.$('[role="tabpanel"][data-state="active"]') }
}
