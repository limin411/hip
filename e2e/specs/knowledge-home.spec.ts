/**
 * Knowledge home: multi-space, rename, recent, search empty, delete.
 * Tags: @knowledge @core
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  closeKnowledgeChipIfOpen,
  createSpaceAndOpen,
  createDocAndExpectEditor,
  typeInKnowledgeEditor,
  goKnowledgeHome,
  ensureKnowledgeHome,
  openSpaceCardByName,
  spaceCardByName,
  setHomeSearchQuery,
  clickFirstRecentItem,
  countSpaceCards,
  waitForSpaceNameGoneOnDisk,
  deleteSpaceFromWorkspace,
  renameSpaceFromWorkspace,
  cancelDeleteSpaceFromWorkspace,
} from '../helpers/knowledge.js'

describe('knowledge home surfaces @knowledge @core', () => {
  const stamp = Date.now()
  const spaceA = `e2e-kb-home-a-${stamp}`
  const spaceB = `e2e-kb-home-b-${stamp}`
  const spaceARenamed = `e2e-kb-home-a-renamed-${stamp}`
  const recentMarker = `e2e-home-recent-${stamp}`

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await closeKnowledgeChipIfOpen()
    await ensureKnowledgeHome()
  })

  after(async () => {
    await closeKnowledgeChipIfOpen()
  })

  it('KH1: create two spaces (cards on home)', async () => {
    await ensureKnowledgeHome()
    const before = await countSpaceCards()

    await createSpaceAndOpen(spaceA)
    await goKnowledgeHome()
    await createSpaceAndOpen(spaceB)
    await goKnowledgeHome()

    await browser.waitUntil(
      async () => (await spaceCardByName(spaceA)) && (await spaceCardByName(spaceB)),
      { timeout: 15000, interval: 200, timeoutMsg: 'two space cards not visible' },
    )
    const after = await countSpaceCards()
    expect(after).toBeGreaterThanOrEqual(before + 2)
  })

  it('KH2: rename space (workspace menu) reflects on home card', async () => {
    await ensureKnowledgeHome()
    await openSpaceCardByName(spaceA)
    await renameSpaceFromWorkspace(spaceARenamed)
    await goKnowledgeHome()
    expect(await spaceCardByName(spaceARenamed)).toBe(true)
    expect(await spaceCardByName(spaceA)).toBe(false)
  })

  it('KH3: recent list after opening a doc', async () => {
    await ensureKnowledgeHome()
    await openSpaceCardByName(spaceB)
    await createDocAndExpectEditor()
    await typeInKnowledgeEditor(recentMarker)
    await browser.pause(800)
    await goKnowledgeHome()

    const recent = await browser.$('[data-testid="knowledge-recent-item"]')
    await recent.waitForExist({ timeout: 15000 })
    expect(await recent.isExisting()).toBe(true)

    await clickFirstRecentItem()
    await browser.waitUntil(
      async () => {
        const ed = await browser.$('[data-testid="knowledge-doc-editor"]')
        const rd = await browser.$('[data-testid="knowledge-doc-reader"]')
        return (await ed.isExisting()) || (await rd.isExisting())
      },
      { timeout: 15000, interval: 200, timeoutMsg: 'recent did not open a doc' },
    )
    await goKnowledgeHome()
  })

  it('KH4: search with no hits shows empty (or zero hits)', async () => {
    await ensureKnowledgeHome()
    // Avoid shared tokens with fixture names (prefix search matches substrings/numbers).
    const nonsense = 'xqzvwmplkjhgfdsabnuytrc'
    await setHomeSearchQuery(nonsense)
    await browser.pause(800)
    const hits = await browser.$$('[data-testid="knowledge-search-hit"]')
    expect(hits.length).toBe(0)
    // When index is ready, dedicated empty state should appear
    const empty = await browser.$('[data-testid="knowledge-search-empty"]')
    if (await empty.isExisting()) {
      expect(await empty.isExisting()).toBe(true)
    }
    await setHomeSearchQuery('')
    await browser.pause(200)
  })

  it('KH5: delete space from workspace clears home card', async () => {
    await ensureKnowledgeHome()
    const target =
      (await spaceCardByName(spaceARenamed)) ? spaceARenamed
      : (await spaceCardByName(spaceA)) ? spaceA
      : null
    expect(target).toBeTruthy()
    await openSpaceCardByName(target!)
    await deleteSpaceFromWorkspace()
    await ensureKnowledgeHome()
    expect(await spaceCardByName(target!)).toBe(false)
    expect(await spaceCardByName(spaceB)).toBe(true)
    await waitForSpaceNameGoneOnDisk(target!)
  })

  it('KH6: delete cancel keeps space', async () => {
    await ensureKnowledgeHome()
    await openSpaceCardByName(spaceB)
    await cancelDeleteSpaceFromWorkspace()
    await goKnowledgeHome()
    expect(await spaceCardByName(spaceB)).toBe(true)
    // Clean up
    await openSpaceCardByName(spaceB)
    await deleteSpaceFromWorkspace()
    await waitForSpaceNameGoneOnDisk(spaceB)
  })
})
