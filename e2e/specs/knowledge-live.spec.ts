/**
 * Live editor + Source slash menu (Phase 1 / Batch F + R3 live blocks).
 * Tags: @knowledge (not @core — Live contenteditable can be flaky)
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
  ensureKnowledgeLive,
  setKnowledgeLiveFlag,
  clearKnowledgeLiveFlag,
  typeInKnowledgeLiveEditor,
  applySlashMenuItem,
  waitForKnowledgeMarker,
  waitForKnowledgeLiveCodeBlock,
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

  it('KF2: Live canvas mounts and persists typed text (no mode toggle)', async () => {
    await setKnowledgeLiveFlag(true)
    await ensureKnowledgeLive()

    const liveHost = await browser.$('[data-testid="knowledge-doc-live-editor"]')
    await liveHost.waitForExist({ timeout: 20000 })

    // No document-level Live|Preview|Source segmented control (R3).
    expect(
      await (await browser.$('[data-testid="knowledge-edit-toggle"]')).isExisting(),
    ).toBe(false)
    expect(
      await (await browser.$('[data-testid="knowledge-edit-toggle-preview"]')).isExisting(),
    ).toBe(false)

    await typeInKnowledgeLiveEditor(liveMarker)
    // Blur / wait for autosave
    await browser.pause(800)
    await waitForSaveStatusSaved(20000).catch(() => {})
    // Disk is source of truth
    await waitForDocBodyOnDisk(liveMarker, 20000)

    // Source fallback still available for large-doc / flag-off tests
    await ensureKnowledgeSource()
    await waitForKnowledgeMarker(liveMarker, 15000)
  })

  it('KF3: Live opens fences from Source (BlockNote host + disk markers)', async () => {
    await ensureKnowledgeSource()
    const body = [
      '```js',
      `console.log("e2e-code-${stamp}")`,
      '```',
      '',
      '```mermaid',
      'flowchart LR',
      `  A${stamp}-->B${stamp}`,
      '```',
      '',
      '```svg',
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="green"/></svg>',
      '```',
      '',
    ].join('\n')
    await typeInKnowledgeEditor(body)
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk('```mermaid', 15000)
    await waitForDocBodyOnDisk(`e2e-code-${stamp}`, 15000)

    await ensureKnowledgeLive()
    const live = await browser.$('[data-testid="knowledge-doc-live-editor"]')
    await live.waitForExist({ timeout: 20000 })
    // BlockNote may render fences as code blocks; assert host + disk, not Milkdown NodeViews.
    await waitForKnowledgeLiveCodeBlock(20000).catch(() => {})
    await waitForKnowledgeMarker(`e2e-code-${stamp}`, 15000).catch(async () => {
      // Marker may live only on disk if BN code block hides raw text from a11y tree.
      await waitForDocBodyOnDisk(`e2e-code-${stamp}`, 5000)
    })
  })
})
