// Unpaid: product Plan chip + /plan forcePlan entry (no LLM required for flag).
import { expect } from 'expect-webdriverio'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createCodeSessionForE2e,
  getActiveSessionId,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { enablePlanModeUi } from '../helpers/eval-plan.js'
import { ensureComposerSecondary } from '../helpers/composer-tune.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { CodePage } from '../page-objects/CodePage.js'

const code = new CodePage()

describe('harness plan entry @harness @core', () => {
  let tmpCwd = ''

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
    try {
      await switchToCodeSurface()
    } catch {
      // already on code
    }
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-plan-entry-'))
  })

  after(() => {
    try {
      if (tmpCwd) fs.rmSync(tmpCwd, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('plan-mode-chip toggles forcePlan on a code session', async () => {
    const sessionId = await createCodeSessionForE2e(tmpCwd)
    expect(sessionId).toBeTruthy()

    const chip = await ensureComposerSecondary('plan-mode-chip')
    expect(await chip.getAttribute('aria-pressed')).not.toBe('true')

    await enablePlanModeUi()

    await browser.waitUntil(
      async () => {
        // Chip may re-pin outside Tune after becoming active.
        let el = await browser.$('[data-testid="plan-mode-chip"]')
        if (!(await el.isExisting())) {
          el = await ensureComposerSecondary('plan-mode-chip')
        }
        const pressed = await el.getAttribute('aria-pressed')
        if (pressed === 'true') return true
        const flag = await browser.execute(() => {
          const hooks = (window as unknown as {
            __hipE2E?: { getActiveSessionForcePlan?: () => boolean | null }
          }).__hipE2E
          return hooks?.getActiveSessionForcePlan?.() ?? null
        })
        return flag === true
      },
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: 'forcePlan not set after plan-mode-chip click',
      },
    )

    const sid = await getActiveSessionId()
    expect(sid).toBeTruthy()
  })

  it('slash /plan is available on code surface', async () => {
    // Ensure code composer exists
    await code.newConversation.waitForExist({ timeout: 30000 }).catch(async () => {
      // session may already exist — use input-bar
    })
    const ta = await browser.$('[data-testid="input-bar"] textarea')
    const draftTa = await browser.$('[data-testid="new-conversation"] textarea')
    const target = (await ta.isExisting()) ? ta : draftTa
    await target.waitForExist({ timeout: 15000 })
    await target.click()
    await target.setValue('/pla')
    const planCmd = await browser.$('[data-testid="slash-cmd-plan"]')
    await planCmd.waitForExist({ timeout: 10000 })
    expect(await planCmd.isExisting()).toBe(true)
    // dismiss palette
    await browser.keys('Escape')
  })
})
