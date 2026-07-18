/**
 * Knowledge spaces in the app sidebar: create, rename, delete, list.
 * Tags: @knowledge @core
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  closeKnowledgeChipIfOpen,
  createSpaceAndOpen,
  ensureKnowledgeHome,
  openSpaceCardByName,
  spaceCardByName,
  waitForSpaceNameGoneOnDisk,
  deleteSpaceFromWorkspace,
  renameSpaceFromWorkspace,
  cancelDeleteSpaceFromWorkspace,
  renameSpaceFromHome,
  deleteSpaceFromHome,
  countSpaceCards,
} from '../helpers/knowledge.js'

describe('knowledge sidebar spaces @knowledge @core', () => {
  const stamp = Date.now()
  const spaceA = `e2e-kb-home-a-${stamp}`
  const spaceB = `e2e-kb-home-b-${stamp}`
  const spaceARenamed = `e2e-kb-home-a-renamed-${stamp}`

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

  it('KH1: create two spaces (sidebar rows)', async () => {
    await ensureKnowledgeHome()
    const before = await countSpaceCards()

    await createSpaceAndOpen(spaceA)
    await ensureKnowledgeHome()
    await createSpaceAndOpen(spaceB)
    await ensureKnowledgeHome()

    await browser.waitUntil(
      async () => (await spaceCardByName(spaceA)) && (await spaceCardByName(spaceB)),
      { timeout: 15000, interval: 200, timeoutMsg: 'two sidebar spaces not visible' },
    )
    const after = await countSpaceCards()
    expect(after).toBeGreaterThanOrEqual(before + 2)
  })

  it('KH2: rename space (workspace menu) reflects in sidebar', async () => {
    await ensureKnowledgeHome()
    await openSpaceCardByName(spaceA)
    await renameSpaceFromWorkspace(spaceARenamed)
    await ensureKnowledgeHome()
    expect(await spaceCardByName(spaceARenamed)).toBe(true)
    expect(await spaceCardByName(spaceA)).toBe(false)
  })

  it('KH3: rename space via sidebar context menu', async () => {
    await ensureKnowledgeHome()
    const renamedAgain = `e2e-kb-home-a-ctx-${stamp}`
    await renameSpaceFromHome(spaceARenamed, renamedAgain)
    expect(await spaceCardByName(renamedAgain)).toBe(true)
    // keep name for later delete steps
    // re-assign via rename back for KH5 target stability
    await renameSpaceFromHome(renamedAgain, spaceARenamed)
  })

  it('KH5: delete space from workspace clears sidebar row', async () => {
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

  it('KH6: delete cancel keeps space; confirm deletes via context menu', async () => {
    await ensureKnowledgeHome()
    await openSpaceCardByName(spaceB)
    await cancelDeleteSpaceFromWorkspace()
    await ensureKnowledgeHome()
    expect(await spaceCardByName(spaceB)).toBe(true)
    // Clean up via sidebar context menu
    await deleteSpaceFromHome(spaceB)
    await waitForSpaceNameGoneOnDisk(spaceB)
  })
})
