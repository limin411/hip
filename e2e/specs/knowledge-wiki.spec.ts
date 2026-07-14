/**
 * Wiki links [[title]] navigation + confirm create (P1.3).
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
  ensureKnowledgeSource,
  ensureKnowledgePreview,
  openTreeDocByTitle,
  clickWikiLinkInPreview,
  confirmWikiCreate,
  cancelWikiCreate,
  expectTreeContains,
  listKnowledgeDocTestIds,
  clearWriteFailSeam,
} from '../helpers/knowledge.js'

describe('knowledge wiki links @knowledge @core', () => {
  const stamp = Date.now()
  const spaceName = `e2e-kb-wiki-${stamp}`
  const targetTitle = `WikiTarget-${stamp}`
  const sourceTitle = `WikiSource-${stamp}`
  const missingTitle = `WikiMissing-${stamp}`

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await closeKnowledgeChipIfOpen()
    await clearWriteFailSeam()

    await openKnowledgeFromMenu()
    await createSpaceAndOpen(spaceName)
  })

  after(async () => {
    await clearWriteFailSeam()
    await closeKnowledgeChipIfOpen()
  })

  it('KW1: resolved [[title]] navigates to target doc in preview', async () => {
    await createDocAndExpectEditor()
    await setKnowledgeDocTitle(targetTitle)
    await typeInKnowledgeEditor(`target-body-${stamp}`)
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(`target-body-${stamp}`, 15000)

    await createNewDocFromMenu()
    await setKnowledgeDocTitle(sourceTitle)
    await typeInKnowledgeEditor(`See [[${targetTitle}]] please.`)
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(`[[${targetTitle}]]`, 15000)

    await ensureKnowledgePreview()
    await clickWikiLinkInPreview(targetTitle, false)
    await browser.pause(400)

    // Target open: reader or editor shows target body
    await browser.waitUntil(
      async () => {
        const title = await browser.$('[data-testid="knowledge-doc-title"]')
        if (await title.isExisting()) {
          const v =
            (await title.getAttribute('value')) ||
            (await title.getText()) ||
            ''
          if (v.includes(targetTitle)) return true
        }
        const reader = await browser.$('[data-testid="knowledge-doc-reader"]')
        if (await reader.isExisting()) {
          return (await reader.getText()).includes(`target-body-${stamp}`)
        }
        const ed = await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
        if (await ed.isExisting()) {
          return (await ed.getText()).includes(`target-body-${stamp}`)
        }
        return false
      },
      { timeout: 15000, interval: 300, timeoutMsg: 'did not navigate to wiki target' },
    )
  })

  it('KW2: broken wiki link confirms create and opens new doc', async () => {
    await openTreeDocByTitle(sourceTitle)
    await ensureKnowledgeSource()
    // Append a broken link (keep prior content ok)
    await typeInKnowledgeEditor(`\n[[${missingTitle}]]`)
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(`[[${missingTitle}]]`, 15000)

    const beforeDocs = (await listKnowledgeDocTestIds()).length

    await ensureKnowledgePreview()
    await clickWikiLinkInPreview(missingTitle, true)

    const modalBody = await browser.$('[data-testid="knowledge-wiki-create-body"]')
    await modalBody.waitForExist({ timeout: 10000 })
    expect(await modalBody.getText()).toContain(missingTitle)

    await confirmWikiCreate()
    await expectTreeContains(missingTitle, 15000)

    const afterDocs = (await listKnowledgeDocTestIds()).length
    expect(afterDocs).toBeGreaterThanOrEqual(beforeDocs + 1)

    // New doc is active (title field)
    await browser.waitUntil(
      async () => {
        const title = await browser.$('[data-testid="knowledge-doc-title"]')
        if (!(await title.isExisting())) return false
        const v =
          (await title.getAttribute('value')) ||
          (await title.getText()) ||
          ''
        return v.includes(missingTitle)
      },
      { timeout: 15000, interval: 300, timeoutMsg: 'created wiki doc not active' },
    )
  })

  it('KW3: cancel wiki create does not add a doc', async () => {
    const cancelTitle = `WikiCancel-${stamp}`
    await openTreeDocByTitle(sourceTitle)
    await ensureKnowledgeSource()
    await typeInKnowledgeEditor(`\n[[${cancelTitle}]]`)
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(`[[${cancelTitle}]]`, 15000)

    const beforeDocs = (await listKnowledgeDocTestIds()).length

    await ensureKnowledgePreview()
    await clickWikiLinkInPreview(cancelTitle, true)
    await (await browser.$('[data-testid="knowledge-wiki-create-cancel"]')).waitForExist({
      timeout: 10000,
    })
    await cancelWikiCreate()

    // Modal gone
    await browser.waitUntil(
      async () =>
        !(await (await browser.$('[data-testid="knowledge-wiki-create-confirm"]')).isExisting()),
      { timeout: 5000, interval: 100 },
    )

    const afterDocs = (await listKnowledgeDocTestIds()).length
    expect(afterDocs).toBe(beforeDocs)
  })
})
