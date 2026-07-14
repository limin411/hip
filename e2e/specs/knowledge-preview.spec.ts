/**
 * Preview interactions: GFM task write-back (P0.3a).
 * Tags: @knowledge @core
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  openKnowledgeFromMenu,
  createSpaceAndOpen,
  createDocAndExpectEditor,
  closeKnowledgeChipIfOpen,
  ensureKnowledgeSource,
  ensureKnowledgePreview,
  typeInKnowledgeEditor,
  toggleFirstTaskCheckbox,
  waitForDocBodyOnDisk,
  waitForSaveStatusSaved,
  clearWriteFailSeam,
} from '../helpers/knowledge.js'

describe('knowledge preview tasks @knowledge @core', () => {
  const stamp = Date.now()
  const spaceName = `e2e-kb-prev-${stamp}`
  const taskMarker = `e2e-task-${stamp}`

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await closeKnowledgeChipIfOpen()
    await clearWriteFailSeam()

    await openKnowledgeFromMenu()
    await createSpaceAndOpen(spaceName)
    await createDocAndExpectEditor()
  })

  after(async () => {
    await clearWriteFailSeam()
    await closeKnowledgeChipIfOpen()
  })

  it('KP1: preview task checkbox write-back persists without edit mode', async () => {
    await ensureKnowledgeSource()
    // GFM task line (must be line-start for remark-gfm)
    await typeInKnowledgeEditor(`- [ ] ${taskMarker}`)
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(`- [ ] ${taskMarker}`, 15000)

    await ensureKnowledgePreview()
    const reader = await browser.$('[data-testid="knowledge-doc-reader"]')
    await reader.waitForExist({ timeout: 10000 })
    expect(await reader.getText()).toContain(taskMarker)

    await toggleFirstTaskCheckbox()
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(`- [x] ${taskMarker}`, 15000)

    // Stay in preview (no source editor) and show checked task
    await ensureKnowledgePreview()
    expect(
      await (await browser.$('[data-testid="knowledge-doc-editor"]')).isExisting(),
    ).toBe(false)
    const box = await browser.$('[data-testid="knowledge-task-checkbox"]')
    await box.waitForExist({ timeout: 10000 })
    const checked = await browser.execute(
      (el: HTMLInputElement) => el.checked === true,
      box,
    )
    expect(checked).toBe(true)
  })
})
