// Smoothness P5: worktree control + goal chrome + dirty preflight (unpaid harness).
// Host "parallel explore" UI removed — multi-worktree via createManagedWorktree / startParallelRun API only.
import { expect } from 'expect-webdriverio'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { createCodeSessionForE2e, injectServerMessage, waitForHipE2E } from '../helpers/e2e-hooks.js'

function initGitRepo(dir: string): void {
  fs.writeFileSync(path.join(dir, 'README.md'), 'e2e worktree base\n')
  execSync('git init', { cwd: dir })
  execSync('git add -A', { cwd: dir })
  execSync('git -c user.email=e2e@hip.test -c user.name=e2e commit -m init', { cwd: dir })
}

describe('smooth P5 worktree + goal @smooth-p5 @harness', () => {
  let dir: string

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-e2e-p5-'))
    initGitRepo(dir)
  })

  after(() => {
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  it('P5 worktree control chip opens popover with single create (no parallel explore)', async () => {
    await createCodeSessionForE2e(dir)
    const { ensureComposerSecondary } = await import('../helpers/composer-tune.js')
    const btn = await ensureComposerSecondary('worktree-control-chip')
    await browser.execute((el: HTMLElement) => el.click(), btn)
    const createCta = await browser.$('[data-testid="worktree-control-create-single"]')
    await createCta.waitForExist({ timeout: 10000 })
    const parallelCta = await browser.$('[data-testid="worktree-control-parallel"]')
    expect(await parallelCta.isExisting()).toBe(false)
    await browser.keys('Escape')
  })

  it('P5-E5/E6 goal chrome via goal:updated product event path', async () => {
    const sessionId = await createCodeSessionForE2e(dir)

    // Product path: same pipeline as WS inbound goal:updated (not store seed).
    await injectServerMessage({
      type: 'goal:updated',
      sessionId,
      goal: {
        id: 'g-e2e-1',
        description: 'Ship smoothness P5',
        status: 'active',
        turns: 1,
        maxTurns: 10,
        tokens: 0,
        maxTokens: 200000,
      },
    })

    const chip = await browser.$('[data-testid="goal-status-chip"]')
    await chip.waitForExist({ timeout: 10000 })
    expect(await chip.getAttribute('data-goal-status')).toBe('active')
    expect(await chip.getText()).toContain('Ship smoothness P5')

    await injectServerMessage({
      type: 'goal:updated',
      sessionId,
      goal: {
        id: 'g-e2e-1',
        description: 'Ship smoothness P5',
        status: 'blocked',
        turns: 2,
        maxTurns: 10,
        tokens: 100,
        maxTokens: 200000,
      },
    })
    await browser.waitUntil(
      async () => (await chip.getAttribute('data-goal-status')) === 'blocked',
      { timeout: 5000 },
    )
  })

  it('P5-E4 dirty worktree preflight rejects remove without force', async () => {
    await createCodeSessionForE2e(dir)
    // Internal multi-create API (host parallel UI removed) — still valid for dirty preflight.
    const fanout = await browser.execute(
      async (baseCwd: string) => {
        const hooks = (window as unknown as {
          __hipE2E?: {
            startParallelRun?: (o: {
              prompt: string
              baseCwd: string
              count: number
            }) => Promise<{ runId: string; slotSessionIds: string[]; slotPaths: string[] }>
          }
        }).__hipE2E
        if (!hooks?.startParallelRun) throw new Error('startParallelRun missing')
        return hooks.startParallelRun({
          prompt: 'preflight slot',
          baseCwd,
          count: 1,
        })
      },
      dir,
    )

    expect(fanout.slotPaths.length).toBeGreaterThanOrEqual(1)
    const wtPath = fanout.slotPaths[0]!
    expect(fs.existsSync(wtPath)).toBe(true)

    // Dirty the managed worktree so preflight must fail.
    fs.writeFileSync(path.join(wtPath, 'dirty-e2e.txt'), 'uncommitted\n')

    // removeWorktree needs a session whose cwd is the main repo.
    const hostId = await createCodeSessionForE2e(dir)
    // Avoid returning a raw `{ error }` object from execute — some WebDriver paths
    // treat that shape as a script failure. Normalize + catch throws.
    const result = await browser.execute(
      async (sessionId: string, worktreePath: string) => {
        const hooks = (window as unknown as {
          __hipE2E?: {
            removeWorktree?: (
              s: string,
              p: string,
              force?: boolean,
            ) => Promise<{ ok: boolean; error?: string }>
          }
        }).__hipE2E
        if (!hooks?.removeWorktree) throw new Error('removeWorktree missing')
        try {
          const r = await hooks.removeWorktree(sessionId, worktreePath, false)
          return {
            removed: r.ok === true,
            reason: r.error ?? '',
            via: 'resolve' as const,
          }
        } catch (e) {
          return {
            removed: false,
            reason: e instanceof Error ? e.message : String(e),
            via: 'throw' as const,
          }
        }
      },
      hostId,
      wtPath,
    )

    expect(result.removed).toBe(false)
    expect(String(result.reason ?? '')).toMatch(/dirty|uncommitted/i)
    // Worktree still on disk after rejected remove.
    expect(fs.existsSync(wtPath)).toBe(true)
  })
})
