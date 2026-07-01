export class CodePage {
  get pickFolder() { return browser.$('[data-testid="pick-folder"]') }
  get newConversation() { return browser.$('[data-testid="new-conversation"]') }
  get folderChip() { return browser.$('[data-testid="folder-chip"]') }
  get changeFolder() { return browser.$('[data-testid="change-folder"]') }
  get clearFolder() { return browser.$('[data-testid="clear-folder"]') }
  get treeBackToChat() { return browser.$('[data-testid="tree-back-to-chat"]') }
  get gitInitButton() { return browser.$('button*=初始化 git 仓库') }

  async pickDirectory(dir: string): Promise<void> {
    await browser.execute((d: string) => {
      (window as unknown as { __hipPickDir?: () => Promise<string> }).__hipPickDir = () => Promise.resolve(d)
    }, dir)

    const pick = await this.pickFolder
    if (await pick.isExisting()) {
      await pick.waitForClickable({ timeout: 10000 })
      await pick.click()
      return
    }

    const change = await this.changeFolder
    await change.waitForClickable({ timeout: 10000 })
    await change.click()
  }

  entry(suffix: string) {
    return browser.$(`[data-testid="tree-entry"][data-path$="${suffix}"]`)
  }
}
