// Unpaid: sticky plan-progress-panel via plan:updated / plan approval seed (no paid LLM).
import { expect } from 'expect-webdriverio'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createChatSessionForE2e,
  seedPlanApproval,
  seedPlanProgress,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { planProgressPanelVisible } from '../helpers/eval-plan.js'
import { switchToChatSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

describe('harness plan progress panel @harness @core', () => {
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

  it('plan:updated seed shows plan-progress-panel with count and checklist', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    const { planItems } = await seedPlanProgress(sessionId)
    expect(planItems.length).toBe(3)

    const panel = await chat.planProgressPanel
    await panel.waitForExist({ timeout: 15000 })
    expect(await planProgressPanelVisible()).toBe(true)

    const count = await chat.planProgressCount
    await count.waitForExist({ timeout: 5000 })
    const countText = await count.getText()
    // 1 completed of 3
    expect(countText).toMatch(/1\s*\/\s*3/)

    // Collapsed by default while executing: current item still visible on the header.
    const current = await chat.planProgressCurrent
    await current.waitForExist({ timeout: 5000 })
    expect(await current.getText()).toContain('e2e progress step two')

    // Expand to review the full checklist.
    const toggle = await browser.$('[data-testid="plan-progress-toggle"]')
    await toggle.waitForExist({ timeout: 5000 })
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await browser.execute((el: HTMLElement) => el.click(), toggle)
    }

    const list = await chat.todoChecklist
    await list.waitForExist({ timeout: 5000 })
    const text = await panel.getText()
    expect(text).toContain('e2e progress step one')
    expect(text).toContain('e2e progress step two')
    expect(text).toContain('e2e progress step three')

    // No approval shell when only plan:updated
    expect(await (await chat.planApprovalCard).isExisting()).toBe(false)
  })

  it('message:complete retains plan-progress-panel (done)', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    await seedPlanProgress(sessionId, { complete: true })

    const panel = await chat.planProgressPanel
    await panel.waitForExist({ timeout: 15000 })
    expect(await planProgressPanelVisible()).toBe(true)

    const count = await chat.planProgressCount
    await count.waitForExist({ timeout: 5000 })
    expect(await count.getText()).toMatch(/1\s*\/\s*3/)

    const toggle = await browser.$('[data-testid="plan-progress-toggle"]')
    await toggle.waitForExist({ timeout: 5000 })
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await browser.execute((el: HTMLElement) => el.click(), toggle)
    }

    const text = await panel.getText()
    expect(text).toContain('e2e progress step one')
  })

  it('plan approval seed nests panel + approval; approve drops card keeps panel', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    await seedPlanApproval(sessionId)

    const panel = await chat.planProgressPanel
    await panel.waitForExist({ timeout: 15000 })
    expect(await planProgressPanelVisible()).toBe(true)

    const card = await chat.planApprovalCard
    await card.waitForExist({ timeout: 5000 })
    const text = await panel.getText()
    expect(text).toContain('e2e plan step one')
    expect(text).toContain('e2e plan step two')

    const approve = await chat.planApprove
    await approve.waitForExist({ timeout: 5000 })
    await browser.execute((el: HTMLElement) => el.click(), approve)

    await browser.waitUntil(
      async () => !(await (await chat.planApprovalCard).isExisting()),
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: 'plan-approval-card still visible after approve',
      },
    )

    // Sticky checklist remains via retained activeTurnPlan (executing).
    await browser.waitUntil(
      async () => (await (await chat.planProgressPanel).isExisting()),
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: 'plan-progress-panel disappeared after approve',
      },
    )
    const afterPanel = await chat.planProgressPanel
    const afterToggle = await browser.$('[data-testid="plan-progress-toggle"]')
    if ((await afterToggle.getAttribute('aria-expanded')) !== 'true') {
      await browser.execute((el: HTMLElement) => el.click(), afterToggle)
    }
    const after = await afterPanel.getText()
    expect(after).toContain('e2e plan step one')
  })
})
