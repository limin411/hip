// Multi-track C: INVALID_WORKFLOW error projection (no paid LLM).
import { expect } from 'expect-webdriverio'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createChatSessionForE2e,
  getWorkflowSession,
  simulateInvalidWorkflowError,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { switchToChatSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

describe('harness invalid workflow @harness @core', () => {
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

  it('shows INVALID_WORKFLOW error and leaves workflow store idle', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    await simulateInvalidWorkflowError(
      sessionId,
      'workflow nodes of type tool|human are not supported',
    )

    const err = await chat.chatError
    await err.waitForExist({ timeout: 15000 })
    const errText = await err.getText()
    // Generic i18n wraps message; reason must be visible.
    expect(errText.toLowerCase()).toMatch(/tool|human|workflow|not supported/)

    const snap = await getWorkflowSession(sessionId)
    expect(snap.activeWorkflow).toBeNull()
    expect(snap.runId).toBeNull()
    expect(snap.runStatus).toBeNull()
    expect(Object.keys(snap.nodeStatuses)).toHaveLength(0)
  })
})
