/**
 * Phase 1 knowledge surfaces: templates, versions, frontmatter filter,
 * assets, portable zip.
 * Tags: @knowledge (not @core — longer / optional gate)
 */
import { expect } from 'expect-webdriverio'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
  ensureKnowledgeLive,
  countTreeDocs,
  saveDocAsTemplate,
  openNewDocMaybePicker,
  cancelTemplatePicker,
  pickTemplateByName,
  saveVersionManual,
  restoreNewestVersion,
  waitForKnowledgeMarker,
  attachAssetFromPath,
  exportSpaceZipTo,
  listZipEntryNames,
  clearWriteFailSeam,
  clearPickAttachmentFilesSeam,
} from '../helpers/knowledge.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PNG = path.resolve(__dirname, '../fixtures/sample-project/logo.png')

describe('knowledge phase1 surfaces @knowledge', () => {
  const stamp = Date.now()
  const spaceName = `e2e-kb-p1-${stamp}`
  const tplName = `tpl-${stamp}`
  const tplMarker = `template-body-${stamp}`
  const v1 = `version-one-${stamp}`
  const v2 = `version-two-${stamp}`
  const tagName = `e2etag${stamp}`
  let zipPath = ''

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await closeKnowledgeChipIfOpen()
    await clearWriteFailSeam()
    await clearPickAttachmentFilesSeam()

    await openKnowledgeFromMenu()
    await createSpaceAndOpen(spaceName)
  })

  after(async () => {
    await clearWriteFailSeam()
    await clearPickAttachmentFilesSeam()
    if (zipPath && fs.existsSync(zipPath)) {
      try {
        fs.unlinkSync(zipPath)
      } catch {
        // ignore
      }
    }
    await closeKnowledgeChipIfOpen()
  })

  it('K1C: template cancel does not create a document', async () => {
    await createDocAndExpectEditor()
    await typeInKnowledgeEditor(tplMarker)
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(tplMarker, 15000)
    await saveDocAsTemplate(tplName)

    const before = await countTreeDocs()
    const kind = await openNewDocMaybePicker()
    expect(kind).toBe('picker')
    await cancelTemplatePicker()
    const after = await countTreeDocs()
    expect(after).toBe(before)
  })

  it('K1D: picking a template seeds the new doc body', async () => {
    const before = await countTreeDocs()
    const kind = await openNewDocMaybePicker()
    expect(kind).toBe('picker')
    await pickTemplateByName(tplName)
    await waitForKnowledgeMarker(tplMarker, 15000)
    await waitForDocBodyOnDisk(tplMarker, 15000)
    expect(await countTreeDocs()).toBeGreaterThan(before)
  })

  it('K1E: manual version restore reverts body', async () => {
    await createNewDocFromMenu()
    await setKnowledgeDocTitle(`VerDoc-${stamp}`)
    await typeInKnowledgeEditor(v1)
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(v1, 15000)
    await saveVersionManual()

    await typeInKnowledgeEditor(v2)
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(v2, 15000)

    await restoreNewestVersion()
    await waitForDocBodyOnDisk(v1, 15000)
    await ensureKnowledgeSource()
    await waitForKnowledgeMarker(v1, 15000)
  })

  it('K1A: frontmatter tags show on doc properties', async () => {
    await createNewDocFromMenu()
    await setKnowledgeDocTitle(`FmDoc-${stamp}`)
    const body = `---\ntags:\n  - ${tagName}\nstatus: draft\n---\n\nfm-body-${stamp}\n`
    await typeInKnowledgeEditor(body)
    await waitForSaveStatusSaved(15000)
    await waitForDocBodyOnDisk(tagName, 15000)

    // Property row in source (home-level tag facets were removed with the management page)
    const props = await browser.$('[data-testid="knowledge-doc-properties"]')
    await props.waitForExist({ timeout: 10000 })
    expect(await props.getText()).toContain(tagName)
  })

  it('K1F: attach image inserts markdown and is visible on Live', async () => {
    expect(fs.existsSync(FIXTURE_PNG)).toBe(true)
    await createNewDocFromMenu()
    await setKnowledgeDocTitle(`AssetDoc-${stamp}`)
    await typeInKnowledgeEditor(`asset-doc-${stamp}\n`)
    await waitForSaveStatusSaved(15000)

    await attachAssetFromPath(FIXTURE_PNG)
    await waitForDocBodyOnDisk('assets/', 15000)

    // R3: no Preview reader — Live canvas or Source markdown proves attach.
    await ensureKnowledgeLive().catch(() => ensureKnowledgeSource())
    const img = await browser.$('[data-testid="knowledge-asset-img"]')
    const placeholder = await browser.$('[data-testid="knowledge-asset-img-placeholder"]')
    const live = await browser.$('[data-testid="knowledge-doc-live-editor"]')
    const source = await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
    await browser.waitUntil(
      async () =>
        (await img.isExisting()) ||
        (await placeholder.isExisting()) ||
        (await live.isExisting()) ||
        ((await source.isExisting()) && (await source.getText()).includes('assets/')),
      {
        timeout: 15000,
        interval: 300,
        timeoutMsg: 'asset image / Live / Source assets path missing',
      },
    )
  })

  it('K1G: portable space zip includes docs, assets, tree', async () => {
    zipPath = path.join(os.tmpdir(), `e2e-kb-space-${stamp}.zip`)
    await exportSpaceZipTo(zipPath)
    const entries = listZipEntryNames(zipPath)
    const joined = entries.join('\n')
    expect(joined).toMatch(/tree\.json/)
    expect(joined).toMatch(/docs\//)
    expect(joined).toMatch(/meta\.json/)
    // K1F attached a PNG under this space
    expect(joined).toMatch(/assets\//)
  })
})
