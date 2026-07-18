/**
 * Unpaid structural gate for the forgejo eval pack:
 * load pack → patch applies on pin → prepareWorkspace primary-guard → cleanup.
 * Does not call a live LLM.
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPack } from '../../load-task.js'
import {
  checkPatchApplies,
  cleanupWorkspace,
  prepareWorkspace,
  primaryMutated,
  snapshotPrimary,
} from '../../workspace.js'
import type { PreparedWorkspace } from '../../types.js'

const packDir = path.dirname(fileURLToPath(import.meta.url))
const FORGEJO =
  process.env.HIP_EVAL_FORGEJO_PATH ||
  '/Users/lijiamin/data/code-repository/project-go/forgejo'

const hasForgejo = fs.existsSync(FORGEJO)

describe.skipIf(!hasForgejo)('forgejo pack workspace isolation (unpaid)', () => {
  let ws: PreparedWorkspace | undefined

  afterEach(() => {
    if (ws) {
      cleanupWorkspace({
        repoPath: ws.repoPath,
        cwd: ws.cwd,
        branch: ws.branch,
        keep: false,
      })
      ws = undefined
    }
  })

  it('loads pack and prepares worktree without mutating primary', () => {
    process.env.HIP_EVAL_FORGEJO_PATH = FORGEJO
    const { pack, tasks } = loadPack(packDir)
    expect(pack.id).toBe('forgejo')
    const task = tasks.find((t) => t.id === 'fj-util-fix-truncate-runes')
    expect(task).toBeTruthy()
    expect(task!.workspace.strategy ?? 'worktree').toBe('worktree')
    expect(task!.verify?.commands?.length).toBeGreaterThan(0)

    const patchPath = path.join(packDir, 'fixtures/break-truncate-runes.patch')
    expect(fs.existsSync(patchPath)).toBe(true)
    checkPatchApplies(FORGEJO, task!.workspace.base_sha ?? 'HEAD', patchPath)

    const before = snapshotPrimary(FORGEJO)
    ws = prepareWorkspace(task!, { packDir, keep: false })
    expect(fs.existsSync(ws.cwd)).toBe(true)
    expect(path.resolve(ws.cwd)).not.toBe(path.resolve(FORGEJO))
    expect(ws.cwd.includes('eval-runs') || ws.cwd.includes('worktrees')).toBe(true)

    const mid = snapshotPrimary(FORGEJO)
    expect(primaryMutated(before, mid)).toBe(false)

    // Break fixture applied: TruncateRunes source should mention intentional bug
    const truncateSrc = fs.readFileSync(path.join(ws.cwd, 'modules/util/truncate.go'), 'utf8')
    expect(truncateSrc).toMatch(/intentional bug|return str/)

    cleanupWorkspace({
      repoPath: ws.repoPath,
      cwd: ws.cwd,
      branch: ws.branch,
      keep: false,
    })
    const gone = ws.cwd
    ws = undefined
    expect(fs.existsSync(gone)).toBe(false)

    const after = snapshotPrimary(FORGEJO)
    expect(primaryMutated(before, after)).toBe(false)
  })
})
