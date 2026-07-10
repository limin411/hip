import { CodePage } from '../page-objects/CodePage.js'

const codePage = new CodePage()

/** One-click git init then open the Changes tab (git-gated). */
export async function initGitAndOpenChanges(): Promise<void> {
  const init = await codePage.gitInitButton
  await init.waitForExist({ timeout: 30000 })
  await init.click()
  const changesTab = await browser.$('[data-testid="tab-changes"]')
  await changesTab.waitForExist({ timeout: 30000 })
  await changesTab.click()
  await (await browser.$('[data-testid="changes-view"]')).waitForExist({ timeout: 30000 })
}

/** Re-open Changes tab to force a diff refresh (no fs watcher). */
export async function reopenChangesTab(): Promise<void> {
  const filesTab = await browser.$('[data-testid="tab-files"]')
  if (await filesTab.isExisting()) {
    await filesTab.click()
  }
  const changesTab = await browser.$('[data-testid="tab-changes"]')
  await changesTab.waitForExist({ timeout: 15000 })
  await changesTab.click()
  await (await browser.$('[data-testid="changes-view"]')).waitForExist({ timeout: 15000 })
}

/**
 * Bind a Code new-conversation draft to `dir`, wait for a tree entry, send first message.
 * Prefer createCodeSessionForE2e when no user message is required (avoids LLM).
 */
export async function commitCodeSessionWithDir(dir: string, message: string, treeHint = '/hello.txt'): Promise<void> {
  await codePage.newConversation.waitForExist({ timeout: 120000 })
  await codePage.pickDirectory(dir)
  await (await codePage.entry(treeHint)).waitForExist({ timeout: 60000 })
  const ta = await browser.$('[data-testid="new-conversation"] textarea')
  await ta.click()
  await browser.keys(message)
  const send = await browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]')
  await send.waitForEnabled({ timeout: 10000 })
  await send.click()
  await codePage.newConversation.waitForExist({ reverse: true, timeout: 30000 })
}

/** Collect text of all `[data-testid="diff-file"]` rows. */
export async function diffFileTexts(): Promise<string> {
  const rows = await browser.$$('[data-testid="diff-file"]')
  const texts = await Promise.all(rows.map((r) => r.getText()))
  return texts.join('\n')
}
