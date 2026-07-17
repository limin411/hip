// Multi-track A: plan approval card via plan:published + plan_approval interrupt (no paid LLM).
import { expect } from 'expect-webdriverio'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { createChatSessionForE2e, seedPlanApproval, waitForHipE2E } from '../helpers/e2e-hooks.js'
import { switchToChatSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

describe('harness plan approval @harness @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
    try {
      await switchToChatSurface()
    } catch {
      // Shared app may already be on chat.
    }
  })

  it('shows plan-approval-card and approve dismisses it optimistically', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    const { planItems } = await seedPlanApproval(sessionId)
    expect(planItems.length).toBeGreaterThanOrEqual(2)

    // Sticky plan panel wraps the approval shell (same checklist + actions).
    const panel = await chat.planProgressPanel
    await panel.waitForExist({ timeout: 15000 })

    const card = await chat.planApprovalCard
    await card.waitForExist({ timeout: 15000 })
    const text = await card.getText()
    expect(text).toContain('e2e plan step one')
    expect(text).toContain('e2e plan step two')

    // Plan approval replaces plain interrupt banner.
    const interrupt = await chat.chatInterrupt
    expect(await interrupt.isExisting()).toBe(false)

    const approve = await chat.planApprove
    await approve.waitForExist({ timeout: 5000 })
    await browser.execute((el: HTMLElement) => el.click(), approve)

    // Product respondPlan clears planApprovalPending immediately — card unmounts.
    await browser.waitUntil(
      async () => !(await (await chat.planApprovalCard).isExisting()),
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: 'plan-approval-card still visible after approve',
      },
    )
  })
})

