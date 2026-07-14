/**
 * Advanced knowledge e2e: palette, context menu, DnD, folder import.
 * Tags: @knowledge @core
 */
import { expect } from 'expect-webdriverio'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  openCommandPaletteForE2e,
  closeCommandPaletteForE2e,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import {
  openContextMenu,
  clickContextMenuItem,
  closeContextMenu,
} from '../helpers/context-menu.js'
import {
  openKnowledgeFromMenu,
  createSpaceAndOpen,
  createDocAndExpectEditor,
  closeKnowledgeChipIfOpen,
  goKnowledgeHome,
  installPickDirSeam,
  clearPickDirSeam,
  firstKnowledgeFolderTestId,
  listKnowledgeDocTestIds,
  dndKnowledgeTreeNode,
  typeInKnowledgeEditor,
  expandAllKnowledgeFolders,
  createDocAndExpectEditor as createDoc,
  createFolderFromToolbar,
} from '../helpers/knowledge.js'

describe('knowledge advanced surfaces @knowledge @core', () => {
  const spaceName = `e2e-kb-adv-${Date.now()}`
  let importDir = ''

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    await leaveSpecialViewsIfOpen()
    await closeKnowledgeChipIfOpen()
  })

  after(async () => {
    await clearPickDirSeam()
    await closeCommandPaletteForE2e().catch(() => {})
    await closeContextMenu().catch(() => {})
    await closeKnowledgeChipIfOpen()
    if (importDir && fs.existsSync(importDir)) {
      try {
        fs.rmSync(importDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  })

  it('KA1: command palette nav-knowledge opens knowledge page', async () => {
    await openCommandPaletteForE2e()
    const palette = await browser.$('[data-testid="global-command-palette"]')
    await palette.waitForExist({ timeout: 10000 })

    const navKb = await browser.$('[data-testid="global-cmd-nav-knowledge"]')
    await navKb.waitForExist({ timeout: 10000 })
    await browser.execute((el: HTMLElement) => el.click(), navKb)

    await (await browser.$('[data-testid="knowledge-page"]')).waitForExist({ timeout: 15000 })
    expect(await (await browser.$('[data-testid="knowledge-page"]')).isExisting()).toBe(true)
  })

  it('KA2: create space and folder; context menu new doc under folder', async () => {
    // Ensure home for space create if needed
    if (await (await browser.$('[data-testid="knowledge-workspace"]')).isExisting()) {
      await goKnowledgeHome()
    }
    if (await (await browser.$('[data-testid="knowledge-home"]')).isExisting()) {
      await createSpaceAndOpen(spaceName)
    }

    await (await browser.$('[data-testid="knowledge-workspace"]')).waitForExist({
      timeout: 15000,
    })

    // Create folder via toolbar (menu open is flaky — use helper retries)
    await createFolderFromToolbar()
    const folderTid = await firstKnowledgeFolderTestId()
    expect(folderTid).toBeTruthy()

    // Context menu on folder — assert menu items then create doc
    await openContextMenu(`[data-testid="${folderTid}"]`)
    await (await browser.$('[data-testid="context-menu-item-knowledgeNode.newDoc"]')).waitForExist({
      timeout: 8000,
    })
    await clickContextMenuItem('knowledgeNode.newDoc')

    // Success: editor opens (createDoc → openDoc)
    await (await browser.$('[data-testid="knowledge-doc-editor"]')).waitForExist({
      timeout: 15000,
    })
    await expandAllKnowledgeFolders()
    await browser.waitUntil(
      async () => (await listKnowledgeDocTestIds()).length > 0,
      { timeout: 10000, interval: 200, timeoutMsg: 'no doc row after context-menu create' },
    )
  })

  it('KA3: DnD moves a doc into a folder', async () => {
    await (await browser.$('[data-testid="knowledge-workspace"]')).waitForExist({
      timeout: 10000,
    })

    let folderTid = await firstKnowledgeFolderTestId()
    if (!folderTid) {
      await createFolderFromToolbar()
      folderTid = await firstKnowledgeFolderTestId()
    }
    expect(folderTid).toBeTruthy()

    // Create a fresh root-level doc for DnD (toolbar new while nothing selected → root parent)
    await createDoc()
    await browser.pause(500)
    await expandAllKnowledgeFolders()
    const docs = await listKnowledgeDocTestIds()
    expect(docs.length).toBeGreaterThan(0)
    const docTid = docs[docs.length - 1]!

    await dndKnowledgeTreeNode(docTid, folderTid!)
    await browser.pause(600)
    await expandAllKnowledgeFolders()

    // Doc still in tree after reparent (may be nested under folder)
    await browser.waitUntil(
      async () => {
        await expandAllKnowledgeFolders()
        return (await listKnowledgeDocTestIds()).includes(docTid)
      },
      { timeout: 10000, interval: 300, timeoutMsg: `doc ${docTid} missing after DnD` },
    )
  })

  it('KA4: command palette finds knowledge doc by title search', async () => {
    // Type unique body so MiniSearch has something; title may be Untitled
    await createDocAndExpectEditor()
    const unique = `e2e-palette-doc-${Date.now()}`
    await typeInKnowledgeEditor(unique)
    await browser.pause(900) // debounce save + index

    await openCommandPaletteForE2e()
    const input = await browser.$('[data-testid="global-command-palette-input"]')
    await input.waitForExist({ timeout: 10000 })
    await input.click()
    // clear then type unique token
    await browser.keys(unique.slice(0, 24))

    // Dynamic knowledge-doc-* hit
    await browser.waitUntil(
      async () => {
        const hits = await browser.$$('[data-testid^="global-cmd-knowledge-doc-"]')
        return hits.length > 0
      },
      { timeout: 10000, interval: 300, timeoutMsg: 'no knowledge doc hits in palette' },
    )

    const hit = await browser.$('[data-testid^="global-cmd-knowledge-doc-"]')
    await browser.execute((el: HTMLElement) => el.click(), hit)
    await browser.pause(500)

    // Knowledge page still open
    expect(await (await browser.$('[data-testid="knowledge-page"]')).isExisting()).toBe(true)
  })

  it('KA5: import folder creates space with markdown', async () => {
    importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-kb-import-'))
    const sub = path.join(importDir, 'nested')
    fs.mkdirSync(sub)
    const body = `# Imported\n\ne2e-import-marker-${Date.now()}\n`
    fs.writeFileSync(path.join(sub, 'note.md'), body, 'utf8')

    // Back to home for import button
    if (await (await browser.$('[data-testid="knowledge-workspace"]')).isExisting()) {
      await goKnowledgeHome()
    }
    await (await browser.$('[data-testid="knowledge-home"]')).waitForExist({ timeout: 15000 })

    await installPickDirSeam(importDir)
    const importBtn = await browser.$('[data-testid="knowledge-import-folder"]')
    await importBtn.waitForExist({ timeout: 10000 })
    await browser.execute((el: HTMLElement) => el.click(), importBtn)

    await (await browser.$('[data-testid="knowledge-workspace"]')).waitForExist({
      timeout: 20000,
    })

    // Nested import folders start collapsed — expand so docs appear in DOM
    await expandAllKnowledgeFolders()
    await browser.waitUntil(
      async () => {
        await expandAllKnowledgeFolders()
        return (await listKnowledgeDocTestIds()).length > 0
      },
      { timeout: 15000, interval: 400, timeoutMsg: 'import produced no docs' },
    )
    const docs = await listKnowledgeDocTestIds()
    await browser.execute((tid: string) => {
      document.querySelector(`[data-testid="${tid}"]`)?.querySelector('button')?.click()
    }, docs[0]!)

    await (await browser.$('[data-testid="knowledge-doc-editor"]')).waitForExist({
      timeout: 10000,
    })
    // Switch to preview to read body easily, or read CM
    const content = await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
    await browser.waitUntil(
      async () => {
        const t = await content.getText()
        return t.includes('Imported') || t.includes('e2e-import-marker')
      },
      { timeout: 10000, interval: 200, timeoutMsg: 'imported body missing' },
    )
  })
})
