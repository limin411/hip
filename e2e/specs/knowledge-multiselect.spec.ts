/**
 * Phase A3: block multi-select (drag-handle menu → batch ops).
 * Tags: @knowledge (not @core — longer / optional gate)
 *
 * Note: the side menu is hover-triggered (floating). Clicking the six-dot
 * drag handle opens the block menu; the "add to selection" item toggles the
 * hovered block in the selection (T4 entry migration).
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  closeKnowledgeChipIfOpen,
  createDocAndExpectEditor,
  createSpaceAndOpen,
  dragKnowledgeLiveHandleToBlock,
  ensureKnowledgeLive,
  openKnowledgeFromMenu,
  setKnowledgeDocTitle,
  typeInKnowledgeLiveEditor,
  waitForSaveStatusSaved,
} from '../helpers/knowledge.js'

const handleTestId = '[data-test="dragHandle"]'
const multiItemTestId = '[data-testid="kb-multiselect-item"]'
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

  it('A3a: drag-handle menu "add to selection" selects a block and batch bar appears', async () => {
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
    // Click the six-dot handle → block menu opens.
    await handle.click()

    const item = await browser.$(multiItemTestId)
    await item.waitForExist({ timeout: 5000 })
    await item.click()

    const bar = await browser.$(barTestId)
    await bar.waitForExist({ timeout: 5000 })
    const count = await browser.$('[data-testid="kb-multiselect-count"]')
    expect((await count.getText()).trim()).toContain('1')

    // Select a second block: hover it, open its menu, add to selection.
    await firstBlock.moveTo({ x: 0, y: 40 })
    const handle2 = await browser.$(handleTestId)
    await handle2.waitForExist({ timeout: 5000 })
    await handle2.click()
    const item2 = await browser.$(multiItemTestId)
    await item2.waitForExist({ timeout: 5000 })
    await item2.click()
    expect((await count.getText()).trim()).toContain('2')
  })

  it('A3b: batch delete removes the selected blocks', async () => {
    const del = await browser.$(deleteTestId)
    await del.waitForExist({ timeout: 5000 })
    await del.click()
    await browser.$(barTestId).waitForExist({ timeout: 5000, reverse: true })
    await waitForSaveStatusSaved(15000)
  })

  it('A3c: dragging the handle across rows selects the contiguous range (X2)', async () => {
    await createDocAndExpectEditor()
    await setKnowledgeDocTitle(`MSDrag-${stamp}`)
    await ensureKnowledgeLive()
    await typeInKnowledgeLiveEditor('drag one')
    await browser.keys(['Enter'])
    await typeInKnowledgeLiveEditor('drag two')
    await browser.keys(['Enter'])
    await typeInKnowledgeLiveEditor('drag three')
    await waitForSaveStatusSaved(15000)

    // Reveal the floating side menu on the first block.
    const firstBlock = await browser.$(
      '[data-testid="knowledge-doc-live-editor"] .bn-block',
    )
    await firstBlock.waitForExist({ timeout: 10000 })
    await firstBlock.moveTo()
    const handle = await browser.$(handleTestId)
    await handle.waitForExist({ timeout: 5000 })

    // Handle drag: origin block 0 → release over block 2 (3 blocks total).
    await dragKnowledgeLiveHandleToBlock(2)

    const bar = await browser.$(barTestId)
    await bar.waitForExist({ timeout: 5000 })
    const count = await browser.$('[data-testid="kb-multiselect-count"]')
    expect((await count.getText()).trim()).toContain('3')

    // Ghost cleared after release: origin block no longer translucent.
    const ghost = await browser.execute(() => {
      const blocks = [
        ...document.querySelectorAll(
          '[data-testid="knowledge-doc-live-editor"] .bn-block',
        ),
      ]
      return blocks.some((b) => b.classList.contains('kb-multiselect-drag'))
    })
    expect(ghost).toBe(false)

    // Clean exit: Esc clears the selection.
    await browser.keys(['Escape'])
    await browser.$(barTestId).waitForExist({ timeout: 5000, reverse: true })
  })
})
