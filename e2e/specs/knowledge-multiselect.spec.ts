/**
 * Phase A3: block multi-select (Shift+click side-menu handle → batch ops).
 * Tags: @knowledge (not @core — longer / optional gate)
 *
 * Note: the side menu is hover-triggered (floating); shift+click on the
 * multi-select handle toggles the hovered block in the selection.
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  closeKnowledgeChipIfOpen,
  createDocAndExpectEditor,
  createSpaceAndOpen,
  ensureKnowledgeLive,
  openKnowledgeFromMenu,
  setKnowledgeDocTitle,
  typeInKnowledgeLiveEditor,
  waitForSaveStatusSaved,
} from '../helpers/knowledge.js'

const handleTestId = '[data-testid="kb-multiselect-handle"]'
const barTestId = '[data-testid="kb-multiselect-bar"]'
const deleteTestId = '[data-testid="kb-multiselect-delete"]'

describe('knowledge phase A3 multi-select @knowledge', () => {
  const stamp = Date.now()
  const spaceName = `e2e-kb-ms-${stamp}`

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await closeKnowledgeChipIfOpen()
    await openKnowledgeFromMenu()
    await createSpaceAndOpen(spaceName)
  })

  after(async () => {
    await closeKnowledgeChipIfOpen()
  })

  it('A3a: Shift+click side-menu handle selects a block and batch bar appears', async () => {
    await createDocAndExpectEditor()
    await setKnowledgeDocTitle(`MSDoc-${stamp}`)
    await ensureKnowledgeLive()
    await typeInKnowledgeLiveEditor('alpha one')
    await browser.keys(['Enter'])
    await typeInKnowledgeLiveEditor('beta two')
    await waitForSaveStatusSaved(15000)

    // Hover the first paragraph to reveal the floating side menu.
    const firstBlock = await browser.$(
      '[data-testid="knowledge-doc-live-editor"] .bn-block',
    )
    await firstBlock.waitForExist({ timeout: 10000 })
    await firstBlock.moveTo()

    const handle = await browser.$(handleTestId)
    await handle.waitForExist({ timeout: 5000 })
    // Shift+click toggles the hovered block into the selection.
    await handle.click({ button: 'left', shiftKey: true })

    const bar = await browser.$(barTestId)
    await bar.waitForExist({ timeout: 5000 })
    const count = await browser.$('[data-testid="kb-multiselect-count"]')
    expect((await count.getText()).trim()).toContain('1')

    // Select a second block: hover it, shift+click again.
    await firstBlock.moveTo({ x: 0, y: 40 })
    const handle2 = await browser.$(handleTestId)
    await handle2.waitForExist({ timeout: 5000 })
    await handle2.click({ button: 'left', shiftKey: true })
    expect((await count.getText()).trim()).toContain('2')
  })

  it('A3b: batch delete removes the selected blocks', async () => {
    const del = await browser.$(deleteTestId)
    await del.waitForExist({ timeout: 5000 })
    await del.click()
    await browser.$(barTestId).waitForExist({ timeout: 5000, reverse: true })
    await waitForSaveStatusSaved(15000)
  })
})
