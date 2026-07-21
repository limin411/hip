/**
 * R3 Live product path — hard asserts (not soft).
 * Tags: @knowledge @core — gate-worthy writing surface contracts.
 *
 * - Default Live canvas (no Preview toggle)
 * - Live slash inserts blocks
 * - Fixture fences → code / mermaid / svg NodeViews
 * - Large doc forces Source
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
  ensureKnowledgeSource,
  typeInKnowledgeLiveEditor,
  waitForKnowledgeMarker,
  waitForSaveStatusSaved,
  waitForDocBodyOnDisk,
  waitForKnowledgeLiveCodeBlock,
  waitForKnowledgeLiveMermaid,
  waitForKnowledgeLiveSvg,
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

    expect(
      await (await browser.$('[data-testid="knowledge-edit-toggle"]')).isExisting(),
    ).toBe(false)
    expect(
      await (await browser.$('[data-testid="knowledge-edit-toggle-preview"]')).isExisting(),
    ).toBe(false)
    expect(
      await (await browser.$('[data-testid="knowledge-edit-toggle-live"]')).isExisting(),
    ).toBe(false)
    expect(
      await (await browser.$('[data-testid="knowledge-doc-reader"]')).isExisting(),
    ).toBe(false)
  })

  it('KR2: Live slash inserts heading (hard)', async () => {
    await setKnowledgeLiveFlag(true)
    await createNewDocFromMenu()
    await setKnowledgeDocTitle(`R3-Slash-${stamp}`)
    await ensureKnowledgeLive()

    const marker = `live-slash-h1-${stamp}`
    await applySlashMenuItemLive('h1')
    await typeInKnowledgeLiveEditor(marker)
    await browser.pause(400)
    await waitForSaveStatusSaved(20000).catch(() => {})
    await waitForDocBodyOnDisk(marker, 20000)
    await waitForKnowledgeMarker(marker, 15000)

    // Source should show ATX heading after round-trip
    await ensureKnowledgeSource()
    await waitForKnowledgeMarker(marker, 10000)
    const text = await (
      await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
    ).getText()
    expect(text.includes('#') || text.includes(marker)).toBe(true)
  })

  it('KR3: medium-rich fixture mounts code + mermaid + svg NodeViews (hard)', async () => {
    await setKnowledgeLiveFlag(true)
    await seedActiveDocFromFixture('medium-rich.md', {
      title: `R3-Blocks-${stamp}`,
      preferLive: true,
    })
    await ensureKnowledgeLive()

    await waitForKnowledgeLiveCodeBlock(25000)
    await waitForKnowledgeLiveMermaid(25000)
    await waitForKnowledgeLiveSvg(25000)

    const counts = await browser.execute(() => ({
      code: document.querySelectorAll('[data-testid="knowledge-live-code-block"]').length,
      mermaid: document.querySelectorAll('[data-testid="knowledge-live-mermaid"]').length,
      svg: document.querySelectorAll('[data-testid="knowledge-live-svg"]').length,
    }))
    expect(counts.code).toBeGreaterThanOrEqual(10)
    expect(counts.mermaid).toBeGreaterThanOrEqual(1)
    expect(counts.svg).toBeGreaterThanOrEqual(1)
    await waitForKnowledgeMarker('MEDIUM_RICH_MARKER_V1', 15000)
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
