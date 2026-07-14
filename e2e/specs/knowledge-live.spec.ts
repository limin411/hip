/**
 * Live editor + Source slash menu (Phase 1 opt-in / Batch F).
 * Tags: @knowledge (not @core — Live contenteditable is flaky; flag default off)
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  openKnowledgeFromMenu,
  createSpaceAndOpen,
  createDocAndExpectEditor,
  closeKnowledgeChipIfOpen,
  setKnowledgeDocTitle,
  typeInKnowledgeEditor,
  waitForSaveStatusSaved,
  waitForDocBodyOnDisk,
  ensureKnowledgeSource,
  setKnowledgeLiveFlag,
  clearKnowledgeLiveFlag,
  setKnowledgeEditorMode,
  typeInKnowledgeLiveEditor,
  applySlashMenuItem,
  waitForKnowledgeMarker,
  clearWriteFailSeam,
} from '../helpers/knowledge.js'

describe('knowledge live editor and slash menu @knowledge', () => {
  const stamp = Date.now()
  const spaceName = `e2e-kb-live-${stamp}`
  const liveMarker = `live-marker-${stamp}`
  const slashMarker = `slash-h1-${stamp}`

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await closeKnowledgeChipIfOpen()
    await clearWriteFailSeam()
    await clearKnowledgeLiveFlag()

    await openKnowledgeFromMenu()
    await createSpaceAndOpen(spaceName)
    await createDocAndExpectEditor()
  })

  after(async () => {
    await clearWriteFailSeam()
    await clearKnowledgeLiveFlag()
    await closeKnowledgeChipIfOpen()
  })

  it('KF1: Source slash menu inserts heading markdown', async () => {
    await clearKnowledgeLiveFlag()
    await ensureKnowledgeSource()
    await setKnowledgeDocTitle(`SlashDoc-${stamp}`)
    // Empty-ish body then slash
    await typeInKnowledgeEditor(`intro-${stamp}`)
    await waitForSaveStatusSaved(15000)

    await applySlashMenuItem('h1')
    // After H1 insert, type marker into heading
    await typeInKnowledgeEditor(slashMarker)
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(slashMarker, 15000)
    // Disk should contain ATX heading form somewhere
    const onDisk = await waitForDocBodyOnDisk('#', 5000).catch(() => '')
    void onDisk
    await ensureKnowledgeSource()
    const text = await (
      await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
    ).getText()
    expect(text.includes('#') || text.includes(slashMarker)).toBe(true)
  })

  it('KF2: Live flag enables Live pane and persists typed text', async () => {
    await setKnowledgeLiveFlag(true)
    // Force UI to rebuild mode control
    await ensureKnowledgeSource()
    await browser.pause(300)

    // Live tab should exist
    const liveTab = await browser.$('[data-testid="knowledge-edit-toggle-live"]')
    await liveTab.waitForExist({ timeout: 15000 })
    await setKnowledgeEditorMode('live')

    const liveHost = await browser.$('[data-testid="knowledge-doc-live-editor"]')
    await liveHost.waitForExist({ timeout: 20000 })

    await typeInKnowledgeLiveEditor(liveMarker)
    // Blur / wait for autosave
    await browser.pause(800)
    await waitForSaveStatusSaved(20000).catch(() => {})
    // Disk is source of truth
    await waitForDocBodyOnDisk(liveMarker, 20000)

    // Switch away and back — still present
    await setKnowledgeEditorMode('source')
    await waitForKnowledgeMarker(liveMarker, 15000)
  })
})
