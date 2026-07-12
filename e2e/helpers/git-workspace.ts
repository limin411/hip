import { CodePage } from '../page-objects/CodePage.js'
import { selectPanelTab } from './panel.js'

const codePage = new CodePage()

/** One-click git init then open the Changes panel tab (git-gated). */
export async function initGitAndOpenChanges(): Promise<void> {
  const init = await codePage.gitInitButton
  await init.waitForExist({ timeout: 30000 })
  await browser.execute((el: HTMLElement) => el.click(), init)

  // After init, Changes appears in the panel menu as panel-tab-changes (not legacy tab-changes).
  await browser.waitUntil(
    async () => {
      try {
        await selectPanelTab('changes')
        return true
      } catch {
        return false
      }
    },
    {
      timeout: 45000,
      interval: 800,
      timeoutMsg: 'panel-tab-changes never available after git init',
    },
  )
  await (await browser.$('[data-testid="changes-view"]')).waitForExist({ timeout: 30000 })
}

/** Re-open Changes tab to force a diff refresh (no fs watcher). */
export async function reopenChangesTab(): Promise<void> {
  const filesView = await browser.$('[data-testid="panel-view-files"]')
  if (await filesView.isExisting()) {
    // already on files — fine
  } else {
    try {
      await selectPanelTab('files')
    } catch {
      // files may already be active without view marker in edge cases
    }
  }
  await selectPanelTab('changes')
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
  // Prefer execute: WDIO ElementArray is not always a plain iterable under WebKit.
  return browser.execute(() =>
    Array.from(document.querySelectorAll('[data-testid="diff-file"]'))
      .map((el) => (el.textContent ?? '').trim())
      .join('\n'),
  )
}
