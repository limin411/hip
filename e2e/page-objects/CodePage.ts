import * as path from 'node:path'

export class CodePage {
  get pickFolder() { return browser.$('[data-testid="pick-folder"]') }
  get newConversation() { return browser.$('[data-testid="new-conversation"]') }

  async pickDirectory(dir: string): Promise<void> {
    await browser.execute((d: string) => {
      (window as unknown as { __hipPickDir?: () => Promise<string> }).__hipPickDir = () => Promise.resolve(d)
    }, dir)
    await (await this.pickFolder).click()
  }

  entry(suffix: string) {
    return browser.$(`[data-testid="tree-entry"][data-path$="${suffix}"]`)
  }
}
