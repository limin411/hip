/**
 * Unpaid visual capture for Code surface chrome used by eval.
 * Saves PNGs under E2E_SCREENSHOT_DIR (or /tmp fallback).
 * @eval @smoke @visual
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { bindFolderViaUi, ensureCodeAppReady } from '../helpers/eval-run.js'
import { setPermissionModeUi } from '../helpers/eval-permissions.js'
import { selectPanelTab } from '../helpers/panel.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { createTempGitRepo, cleanupWorkspace, prepareWorkspace } from '../eval/workspace.js'
import type { TaskSpec } from '../eval/types.js'
import { CodePage } from '../page-objects/CodePage.js'
import { expect } from 'expect-webdriverio'

const codePage = new CodePage()
const shotDir =
  process.env.E2E_SCREENSHOT_DIR ||
  path.join(os.tmpdir(), 'hip-e2e-screenshots')

async function shot(name: string): Promise<string> {
  fs.mkdirSync(shotDir, { recursive: true })
  const file = path.join(shotDir, `visual-${name}.png`)
  await browser.saveScreenshot(file)
  return file
}

const cleanups: Array<() => void> = []

describe('eval UI visual capture @eval @smoke @visual', () => {
  after(() => {
    while (cleanups.length) {
      try {
        cleanups.pop()?.()
      } catch {
        // ignore
      }
    }
  })

  it('captures Code landing, folder chip, permission chip, Changes chrome', async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await switchToCodeSurface()
    await codePage.newConversation.waitForExist({ timeout: 120000 })

    const landing = await shot('01-code-landing')
    expect(fs.existsSync(landing)).toBe(true)

    // Fresh picker if possible
    const pickExists = await codePage.pickFolder.isExisting()
    if (!pickExists && (await codePage.clearFolder.isExisting())) {
      await codePage.clearFolder.click()
      await codePage.pickFolder.waitForExist({ timeout: 10000 })
    }
    await shot('02-folder-picker')

    const repo = createTempGitRepo('eval-visual')
    cleanups.push(() => fs.rmSync(repo, { recursive: true, force: true }))
    const task: TaskSpec = {
      schemaVersion: 1,
      id: 'visual-bind',
      name: 'visual',
      prompt: 'noop',
      workspace: {
        strategy: 'worktree',
        repo_path: repo,
        base_ref: 'HEAD',
        setup: { kind: 'none' },
      },
      ui: { surface: 'code', permission_mode: 'edit' },
    }
    const ws = prepareWorkspace(task, { packDir: repo })
    cleanups.push(() => cleanupWorkspace({ ...ws, keep: false }))

    await bindFolderViaUi(ws.cwd)
    await shot('03-folder-chip-bound')

    const perm = await browser.$('[data-testid="permission-chip"]')
    await perm.waitForExist({ timeout: 15000 })
    expect(await perm.isExisting()).toBe(true)
    // Chip label should stay short (zh "编辑文件" / en "Edit files")
    const chipText = (await perm.getText()).replace(/\s+/g, '')
    expect(chipText.length).toBeLessThanOrEqual(12)

    // Draft landing still has folder chip
    expect(await codePage.folderChip.isExisting()).toBe(true)

    await setPermissionModeUi('edit')
    await shot('04-permission-edit')

    await setPermissionModeUi('full')
    await shot('05-permission-full-selected')
    await setPermissionModeUi('chat')
    await shot('06-permission-chat-selected')
    // Restore edit for remaining checks
    await setPermissionModeUi('edit')

    // Create a code session so Files panel can appear (folder chip is draft-only)
    const { createCodeSessionForE2e, waitForHipE2E } = await import('../helpers/e2e-hooks.js')
    await waitForHipE2E()
    await createCodeSessionForE2e(ws.cwd)
    await browser.pause(800)
    await shot('07-session-active')

    // Session chrome: permission + send still present
    const permSession = await browser.$('[data-testid="permission-chip"]')
    await permSession.waitForExist({ timeout: 15000 })
    expect(await permSession.isExisting()).toBe(true)
    const send = await browser.$('[data-testid="composer-send"]')
    const stop = await browser.$('[data-testid="composer-stop"]')
    expect((await send.isExisting()) || (await stop.isExisting())).toBe(true)

    try {
      await selectPanelTab('files')
      await shot('08-files-panel')
    } catch {
      await shot('08-files-panel-missing')
    }

    cleanupWorkspace({ ...ws, keep: false })
  })
})
