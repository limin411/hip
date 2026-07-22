/**
 * Unpaid eval plumbing: task load + worktree + UI folder bind.
 * No LLM. Tag: @eval @smoke
 */
import { expect } from 'expect-webdriverio'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { bindFolderViaUi, ensureCodeAppReady } from '../helpers/eval-run.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { loadPack } from '../eval/load-task.js'
import {
  cleanupWorkspace,
  createTempGitRepo,
  prepareWorkspace,
  primaryMutated,
  snapshotPrimary,
} from '../eval/workspace.js'
import type { TaskSpec } from '../eval/types.js'
import { CodePage } from '../page-objects/CodePage.js'

const codePage = new CodePage()
const cleanups: Array<() => void> = []

describe('eval UI smoke @eval @smoke', () => {
  after(() => {
    while (cleanups.length) {
      try {
        cleanups.pop()?.()
      } catch {
        // ignore
      }
    }
  })

  it('loads bytebase-pilot pack manifest and three task ids', () => {
    const packDir = path.resolve('e2e/eval/tasks/bytebase-pilot')
    const { pack, tasks } = loadPack(packDir)
    expect(pack.id).toBe('bytebase-pilot')
    expect(tasks.map((t) => t.id).sort()).toEqual(
      [
        'bb-common-fix-has-prefixes',
        'bb-common-nav-truncate',
        'bb-stress-timeout',
      ].sort(),
    )
    for (const t of tasks) {
      expect(t.prompt.length).toBeGreaterThan(10)
      expect(t.ui.permission_mode === undefined || t.ui.permission_mode === 'edit' || t.workspace).toBeTruthy()
    }
  })

  it('prepares a worktree from a temp git repo without mutating primary', async () => {
    const repo = createTempGitRepo('eval-ui-smoke')
    cleanups.push(() => fs.rmSync(repo, { recursive: true, force: true }))

    const before = snapshotPrimary(repo)
    const task: TaskSpec = {
      schemaVersion: 1,
      id: 'smoke-bind',
      name: 'smoke',
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

    expect(fs.existsSync(path.join(ws.cwd, 'README.md'))).toBe(true)

    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await switchToCodeSurface()
    await bindFolderViaUi(ws.cwd)

    await codePage.folderChip.waitForExist({ timeout: 10000 })
    const chip = await codePage.folderChip.getText()
    expect(chip).toContain(path.basename(ws.cwd))

    // permission chip present on code surface (under Tune when default edit mode)
    const { ensureComposerSecondary } = await import('../helpers/composer-tune.js')
    const perm = await ensureComposerSecondary('permission-chip')
    expect(await perm.isExisting()).toBe(true)

    cleanupWorkspace({ ...ws, keep: false })
    const after = snapshotPrimary(repo)
    expect(primaryMutated(before, after)).toBe(false)
  })

  it('ensureCodeAppReady reaches code new-conversation landing', async () => {
    await ensureCodeAppReady()
    await codePage.newConversation.waitForExist({ timeout: 60000 })
    // After a prior bind, chip may already be set; otherwise pick-folder is shown.
    const hasPick = await codePage.pickFolder.isExisting()
    const hasChip = await codePage.folderChip.isExisting()
    expect(hasPick || hasChip).toBe(true)
  })
})
