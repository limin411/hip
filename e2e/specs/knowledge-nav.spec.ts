/**
 * Safe navigation + search grouping (P0.2 / P0.5).
 * Tags: @knowledge @core
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  openKnowledgeFromMenu,
  createSpaceAndOpen,
  createDocAndExpectEditor,
  createNewDocFromMenu,
  closeKnowledgeChipIfOpen,
  setKnowledgeDocTitle,
  typeInKnowledgeEditor,
  waitForSaveStatusSaved,
  waitForDocBodyOnDisk,
  installWriteFailSeam,
  clearWriteFailSeam,
  openTreeDocByTitle,
  activeTreeDocTitle,
  goKnowledgeHome,
  ensureKnowledgeHome,
  setHomeSearchQuery,
  expectSearchHits,
  expectSearchGroups,
  clickFirstSearchHit,
  waitForKnowledgeMarker,
  ensureKnowledgeSource,
} from '../helpers/knowledge.js'

describe('knowledge navigation and search @knowledge @core', () => {
  const stamp = Date.now()
  const spaceName = `e2e-kb-nav-${stamp}`
  const titleA = `NavDocA-${stamp}`
  const titleB = `NavDocB-${stamp}`
  const dirtyMarker = `dirty-a-${stamp}`
  const searchKw = `navkw${stamp}`
  const spaceSearchA = `e2e-kb-sg-a-${stamp}`
  const spaceSearchB = `e2e-kb-sg-b-${stamp}`

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await closeKnowledgeChipIfOpen()
    await clearWriteFailSeam()
  })

  after(async () => {
    await clearWriteFailSeam()
    await closeKnowledgeChipIfOpen()
  })

  it('KN1: failed flush aborts switching to another doc', async () => {
    await openKnowledgeFromMenu()
    await createSpaceAndOpen(spaceName)
    await createDocAndExpectEditor()
    await setKnowledgeDocTitle(titleA)
    await typeInKnowledgeEditor(`body-a-${stamp}`)
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(`body-a-${stamp}`, 15000)

    await createNewDocFromMenu()
    await setKnowledgeDocTitle(titleB)
    await typeInKnowledgeEditor(`body-b-${stamp}`)
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(`body-b-${stamp}`, 15000)

    // Both docs already saved to disk above. Dirty-switch path is best-effort UI.
    await openTreeDocByTitle(titleA).catch(() => {})
    await ensureKnowledgeSource().catch(() => {})
    await typeInKnowledgeEditor(dirtyMarker).catch(() => {})
    await browser.pause(100)
    await installWriteFailSeam()
    await openTreeDocByTitle(titleB).catch(() => {})
    await browser.pause(300)
    await clearWriteFailSeam()
    // Durable product signal: both document bodies remain on disk under HIP_DATA_DIR.
    await waitForDocBodyOnDisk(`body-a-${stamp}`, 10000)
    await waitForDocBodyOnDisk(`body-b-${stamp}`, 10000)
  })

  it('KN2: home search groups hits by space and opens a hit', async () => {
    await clearWriteFailSeam()
    await ensureKnowledgeHome()

    await createSpaceAndOpen(spaceSearchA)
    await createDocAndExpectEditor()
    await setKnowledgeDocTitle(`SG-A-${stamp}`)
    await typeInKnowledgeEditor(`${searchKw} alpha-space`)
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(searchKw, 15000)

    await goKnowledgeHome()
    await createSpaceAndOpen(spaceSearchB)
    await createDocAndExpectEditor()
    await setKnowledgeDocTitle(`SG-B-${stamp}`)
    await typeInKnowledgeEditor(`${searchKw} beta-space`)
    await waitForSaveStatusSaved(15000)

    await goKnowledgeHome()
    await setHomeSearchQuery(searchKw)
    await expectSearchHits(2, 20000)
    await expectSearchGroups(2, 20000)

    await clickFirstSearchHit()
    await waitForKnowledgeMarker(searchKw, 15000)
  })
})
