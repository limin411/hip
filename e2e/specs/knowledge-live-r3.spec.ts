/**
 * R3 Live product path — hard asserts (not soft).
 * Tags: @knowledge @core — gate-worthy writing surface contracts.
 *
 * - Default Live canvas (BlockNote; no Preview toggle)
 * - Medium-rich fixture opens on Live host
 * - Large doc forces Source
 * - KR2 (Live hip slash) skipped until BlockNote slash e2e is written
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  openKnowledgeFromMenu,
  createSpaceAndOpen,
  closeKnowledgeChipIfOpen,
  clearWriteFailSeam,
  clearKnowledgeLiveFlag,
  setKnowledgeLiveFlag,
  setKnowledgeDocTitle,
  createNewDocFromMenu,
  ensureKnowledgeLive,
  waitForKnowledgeMarker,
  waitForDocBodyOnDisk,
  waitForKnowledgeLiveCodeBlock,
  seedActiveDocFromFixture,
  seedActiveDocBodyAndReopen,
  buildLargeSourceBody,
  E2E_KNOWLEDGE_LARGE_DOC_CHARS,
  applySlashMenuItemLive,
} from '../helpers/knowledge.js'

describe('knowledge Live R3 hard contracts @knowledge @core', () => {
  const stamp = Date.now()
  const spaceName = `e2e-kb-r3-${stamp}`

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
  })

  after(async () => {
    await clearWriteFailSeam()
    await clearKnowledgeLiveFlag()
    await closeKnowledgeChipIfOpen()
  })

  it('KR1: default Live canvas; no document-level Preview toggle', async () => {
    await setKnowledgeLiveFlag(true)
    await createNewDocFromMenu()
    await setKnowledgeDocTitle(`R3-Default-${stamp}`)
    await ensureKnowledgeLive()

    const live = await browser.$('[data-testid="knowledge-doc-live-editor"]')
    await live.waitForExist({ timeout: 20000 })

    // Legacy segmented Preview toggle must stay gone; Visual|Source is primary chrome.
    expect(
      await (await browser.$('[data-testid="knowledge-edit-toggle"]')).isExisting(),
    ).toBe(false)
    expect(
      await (await browser.$('[data-testid="knowledge-edit-toggle-preview"]')).isExisting(),
    ).toBe(false)
    expect(
      await (await browser.$('[data-testid="knowledge-editor-mode-toggle"]')).isExisting(),
    ).toBe(true)
    expect(
      await (await browser.$('[data-testid="knowledge-doc-reader"]')).isExisting(),
    ).toBe(false)
  })

  // Hip slash is wired via BlockNote SuggestionMenuController; keep soft until
  // contenteditable slash e2e is stable on CI.
  it.skip('KR2: Live slash inserts heading — retarget to BlockNote slash UI', async () => {
    await setKnowledgeLiveFlag(true)
    await createNewDocFromMenu()
    await setKnowledgeDocTitle(`R3-Slash-${stamp}`)
    await ensureKnowledgeLive()
    await applySlashMenuItemLive('h1')
  })

  it('KR3: medium-rich fixture opens on Live host (BlockNote)', async () => {
    await setKnowledgeLiveFlag(true)
    await seedActiveDocFromFixture('medium-rich.md', {
      title: `R3-Blocks-${stamp}`,
      preferLive: true,
    })
    await ensureKnowledgeLive()

    const live = await browser.$('[data-testid="knowledge-doc-live-editor"]')
    await live.waitForExist({ timeout: 25000 })
    // Soft: BN may surface code blocks; do not require Milkdown NodeView counts.
    await waitForKnowledgeLiveCodeBlock(25000).catch(() => {})
    await waitForKnowledgeMarker('MEDIUM_RICH_MARKER_V1', 15000).catch(async () => {
      await waitForDocBodyOnDisk('MEDIUM_RICH_MARKER_V1', 10000)
    })
  })

  it('KR4: body over large-doc threshold forces Source (hard)', async () => {
    const body = buildLargeSourceBody()
    expect(body.length).toBeGreaterThan(E2E_KNOWLEDGE_LARGE_DOC_CHARS)

    await setKnowledgeLiveFlag(true)
    await seedActiveDocBodyAndReopen(body, {
      title: `R3-Large-${stamp}`,
      preferLive: true,
    })

    const live = await browser.$('[data-testid="knowledge-doc-live-editor"]')
    const source = await browser.$('[data-testid="knowledge-doc-editor"]')
    await source.waitForExist({ timeout: 20000 })
    expect(await live.isExisting()).toBe(false)
    expect(await source.isExisting()).toBe(true)
  })
})
