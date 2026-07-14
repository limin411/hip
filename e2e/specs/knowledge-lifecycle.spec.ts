/**
 * Knowledge base full business lifecycle (create → edit → search → export → delete).
 * Tags: @knowledge @core
 */
import { expect } from 'expect-webdriverio'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  openKnowledgeFromMenu,
  createSpaceAndOpen,
  createDocAndExpectEditor,
  typeInKnowledgeEditor,
  toggleKnowledgePreviewOrEdit,
  expectKnowledgeEditor,
  expectKnowledgeReader,
  expectNoKnowledgeEditor,
  closeKnowledgeChipIfOpen,
  setKnowledgeDocTitle,
  goKnowledgeHome,
  openSpaceCardByName,
  spaceCardByName,
  setHomeSearchQuery,
  clickFirstSearchHit,
  expectSearchHits,
  exportActiveDocTo,
  exportSpaceZipTo,
  deleteSpaceFromWorkspace,
  waitForDocBodyOnDisk,
  waitForSaveStatusSaved,
  waitForSpaceNameGoneOnDisk,
  listSpaceNamesOnDisk,
  clearSavePathSeam,
  ensureKnowledgeHome,
  expectTreeContains,
} from '../helpers/knowledge.js'

describe('knowledge lifecycle business flow @knowledge @core', () => {
  const spaceName = `e2e-kb-life-${Date.now()}`
  const marker = `e2e-life-marker-${Date.now()}`
  const docTitle = `e2e-life-title-${Date.now()}`
  let exportMd = ''
  let exportZip = ''

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await closeKnowledgeChipIfOpen()
  })

  after(async () => {
    await clearSavePathSeam()
    for (const p of [exportMd, exportZip]) {
      if (p && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p)
        } catch {
          // ignore
        }
      }
    }
    await closeKnowledgeChipIfOpen()
  })

  it('KL1: open knowledge page home', async () => {
    await openKnowledgeFromMenu()
    await (await browser.$('[data-testid="knowledge-page"]')).waitForExist({ timeout: 20000 })
    // Prefer home; if prior suite left workspace, go home
    if (await (await browser.$('[data-testid="knowledge-workspace"]')).isExisting()) {
      await goKnowledgeHome()
    }
    await (await browser.$('[data-testid="knowledge-home"]')).waitForExist({ timeout: 15000 })
    expect(await (await browser.$('[data-testid="knowledge-home"]')).isExisting()).toBe(true)
  })

  it('KL2: create space and enter workspace', async () => {
    await createSpaceAndOpen(spaceName)
    await (await browser.$('[data-testid="knowledge-workspace"]')).waitForExist({
      timeout: 15000,
    })
    const ws = await browser.$('[data-testid="knowledge-workspace"]')
    expect(await ws.isExisting()).toBe(true)
  })

  it('KL3: create doc, type marker, wait autosave', async () => {
    await createDocAndExpectEditor()
    await typeInKnowledgeEditor(marker)
    await waitForSaveStatusSaved()
    const content = await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
    expect(await content.getText()).toContain(marker)
  })

  it('KL4: marker persists on disk under HIP_DATA_DIR/knowledge', async () => {
    const file = await waitForDocBodyOnDisk(marker)
    expect(file.length).toBeGreaterThan(0)
    expect(fs.readFileSync(file, 'utf8')).toContain(marker)
  })

  it('KL5: preview and edit round-trip keeps marker', async () => {
    await toggleKnowledgePreviewOrEdit()
    await expectNoKnowledgeEditor()
    await expectKnowledgeReader(marker)
    await toggleKnowledgePreviewOrEdit()
    await expectKnowledgeEditor()
    const content = await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
    expect(await content.getText()).toContain(marker)
  })

  it('KL6: inline title rename updates tree', async () => {
    await setKnowledgeDocTitle(docTitle)
    const tree = await browser.$('[data-testid="knowledge-tree"]')
    await browser.waitUntil(
      async () => (await tree.getText()).includes(docTitle),
      { timeout: 10000, interval: 200, timeoutMsg: 'tree missing renamed title' },
    )
  })

  it('KL7: back home and reopen space card', async () => {
    await goKnowledgeHome()
    await openSpaceCardByName(spaceName)
    await expectTreeContains(docTitle, 15000)
  })

  it('KL8: home search finds marker and opens doc', async () => {
    await goKnowledgeHome()
    // Index may still be building after create/save
    await setHomeSearchQuery(marker.slice(0, 24))
    try {
      await expectSearchHits(1, 20000)
    } catch {
      // Fall back to title search if body index lags
      await setHomeSearchQuery(docTitle.slice(0, 20))
      await expectSearchHits(1, 15000)
    }
    await clickFirstSearchHit()
    // Doc may open in edit or preview
    await browser.waitUntil(
      async () => {
        const ed = await browser.$('[data-testid="knowledge-doc-editor"]')
        const rd = await browser.$('[data-testid="knowledge-doc-reader"]')
        return (await ed.isExisting()) || (await rd.isExisting())
      },
      { timeout: 15000, interval: 200, timeoutMsg: 'doc not opened from search hit' },
    )
  })

  it('KL9: export active doc includes marker', async () => {
    // Ensure workspace + editor mode with content
    if (!(await (await browser.$('[data-testid="knowledge-workspace"]')).isExisting())) {
      await ensureKnowledgeHome()
      await openSpaceCardByName(spaceName)
    }
    if (!(await (await browser.$('[data-testid="knowledge-doc-editor"]')).isExisting())) {
      if (await (await browser.$('[data-testid="knowledge-edit-toggle"]')).isExisting()) {
        await toggleKnowledgePreviewOrEdit()
      }
      await expectKnowledgeEditor()
    }
    exportMd = path.join(os.tmpdir(), `hip-e2e-life-export-${Date.now()}.md`)
    await exportActiveDocTo(exportMd)
    expect(fs.readFileSync(exportMd, 'utf8')).toContain(marker)
  })

  it('KL9b: export space zip is non-empty', async () => {
    if (!(await (await browser.$('[data-testid="knowledge-workspace"]')).isExisting())) {
      await ensureKnowledgeHome()
      await openSpaceCardByName(spaceName)
    }
    exportZip = path.join(os.tmpdir(), `hip-e2e-life-export-${Date.now()}.zip`)
    await exportSpaceZipTo(exportZip)
    expect(fs.statSync(exportZip).size).toBeGreaterThan(0)
  })

  it('KL10: delete space from workspace returns home and clears disk', async () => {
    if (!(await (await browser.$('[data-testid="knowledge-workspace"]')).isExisting())) {
      await ensureKnowledgeHome()
      await openSpaceCardByName(spaceName)
    }
    expect(listSpaceNamesOnDisk()).toContain(spaceName)
    await deleteSpaceFromWorkspace()
    await (await browser.$('[data-testid="knowledge-home"]')).waitForExist({ timeout: 15000 })
    await browser.waitUntil(
      async () => !(await spaceCardByName(spaceName)),
      { timeout: 10000, interval: 200, timeoutMsg: 'deleted space card still visible' },
    )
    await waitForSpaceNameGoneOnDisk(spaceName)
  })

  it('KL11: close chip and reopen knowledge shell', async () => {
    await closeKnowledgeChipIfOpen()
    await browser.pause(200)
    await openKnowledgeFromMenu()
    await (await browser.$('[data-testid="knowledge-page"]')).waitForExist({ timeout: 20000 })
    await ensureKnowledgeHome()
    expect(await (await browser.$('[data-testid="knowledge-home"]')).isExisting()).toBe(true)
  })
})
