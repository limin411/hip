/**
 * GFM task write-back (formerly Preview-only). R3: Live is writing canvas;
 * interactive task chrome may be Source/Live; disk is source of truth.
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
  ensureKnowledgeLive,
  typeInKnowledgeEditor,
  toggleFirstTaskCheckbox,
  waitForDocBodyOnDisk,
  waitForSaveStatusSaved,
  waitForKnowledgeMarker,
  clearWriteFailSeam,
} from '../helpers/knowledge.js'

describe('knowledge task write-back @knowledge @core', () => {
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

  it('KP1: GFM task checkbox write-back persists (Source/Live, not Preview)', async () => {
    await ensureKnowledgeSource()
    // GFM task line (must be line-start for remark-gfm)
    await typeInKnowledgeEditor(`- [ ] ${taskMarker}`)
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(`- [ ] ${taskMarker}`, 15000)

    // Product canvas is Live — marker should be visible without a Preview mode.
    await ensureKnowledgeLive()
    await waitForKnowledgeMarker(taskMarker, 15000)
    // No document-level Preview writing surface.
    expect(
      await (await browser.$('[data-testid="knowledge-doc-reader"]')).isExisting(),
    ).toBe(false)
    expect(
      await (await browser.$('[data-testid="knowledge-edit-toggle-preview"]')).isExisting(),
    ).toBe(false)

    await toggleFirstTaskCheckbox()
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(`- [x] ${taskMarker}`, 15000)

    // Surface still shows marker after check (Live or Source after toggle helper).
    await waitForKnowledgeMarker(taskMarker, 15000)
  })
})
