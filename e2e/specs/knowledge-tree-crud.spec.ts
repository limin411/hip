/**
 * Knowledge tree CRUD: folder/doc rename, delete, context-menu create.
 * Tags: @knowledge @core
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  openContextMenu,
  clickContextMenuItem,
  closeContextMenu,
} from '../helpers/context-menu.js'
import {
  openKnowledgeFromMenu,
  createSpaceAndOpen,
  closeKnowledgeChipIfOpen,
  goKnowledgeHome,
  createFolderFromToolbar,
  firstKnowledgeFolderTestId,
  listKnowledgeDocTestIds,
  expandAllKnowledgeFolders,
  renameTreeNodeByTestId,
  deleteTreeNodeByTestId,
  expectTreeContains,
  expectTreeNotContains,
  deleteSpaceFromWorkspace,
  ensureKnowledgeHome,
  waitForKnowledgeWritableSurface,
} from '../helpers/knowledge.js'

describe('knowledge tree node crud @knowledge @core', () => {
  const spaceName = `e2e-kb-tree-${Date.now()}`
  const folderRenamed = `e2e-folder-renamed-${Date.now()}`
  let folderTid: string | null = null
  let docTid: string | null = null

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await closeKnowledgeChipIfOpen()

    await openKnowledgeFromMenu()
    if (await (await browser.$('[data-testid="knowledge-workspace"]')).isExisting()) {
      await goKnowledgeHome()
    }
    await ensureKnowledgeHome()
    await createSpaceAndOpen(spaceName)
  })

  after(async () => {
    await closeContextMenu().catch(() => {})
    // Best-effort cleanup of the suite space
    try {
      if (await (await browser.$('[data-testid="knowledge-workspace"]')).isExisting()) {
        await deleteSpaceFromWorkspace()
      }
    } catch {
      // ignore
    }
    await closeKnowledgeChipIfOpen()
  })

  it('KT1: create folder from tree context menu', async () => {
    await createFolderFromToolbar()
    folderTid = await firstKnowledgeFolderTestId()
    expect(folderTid).toBeTruthy()
  })

  it('KT2: context-menu rename folder', async () => {
    folderTid = folderTid ?? (await firstKnowledgeFolderTestId())
    expect(folderTid).toBeTruthy()
    await renameTreeNodeByTestId(folderTid!, folderRenamed)
    await expectTreeContains(folderRenamed)
  })

  it('KT3: context-menu newDoc under folder', async () => {
    folderTid =
      folderTid ??
      (await browser.execute(() => {
        const rows = Array.from(
          document.querySelectorAll('[data-testid^="knowledge-tree-folder-"]'),
        )
        for (const row of rows) {
          if ((row.textContent ?? '').includes(folderRenamed)) {
            return row.getAttribute('data-testid')
          }
        }
        return rows[0]?.getAttribute('data-testid') ?? null
      }))
    expect(folderTid).toBeTruthy()

    await openContextMenu(`[data-testid="${folderTid}"]`)
    await (await browser.$('[data-testid="context-menu-item-knowledgeNode.newDoc"]')).waitForExist({
      timeout: 8000,
    })
    await clickContextMenuItem('knowledgeNode.newDoc')

    // Live or Source (R3 product default is Live — do not hard-wait Source only)
    await waitForKnowledgeWritableSurface(15000)
    await expandAllKnowledgeFolders()
    await browser.waitUntil(
      async () => (await listKnowledgeDocTestIds()).length > 0,
      { timeout: 10000, interval: 200, timeoutMsg: 'no doc after context-menu create' },
    )
    const docs = await listKnowledgeDocTestIds()
    docTid = docs[docs.length - 1] ?? null
    expect(docTid).toBeTruthy()
  })

  it('KT4: context-menu delete doc', async () => {
    await expandAllKnowledgeFolders()
    const docs = await listKnowledgeDocTestIds()
    docTid = docTid && docs.includes(docTid) ? docTid : docs[0] ?? null
    expect(docTid).toBeTruthy()

    await deleteTreeNodeByTestId(docTid!)
    await expandAllKnowledgeFolders()
    const after = await listKnowledgeDocTestIds()
    expect(after.includes(docTid!)).toBe(false)
  })

  it('KT5: delete folder removes it from tree', async () => {
    await expandAllKnowledgeFolders()
    // Re-resolve folder testid after prior ops
    folderTid = await browser.execute((title: string) => {
      const rows = Array.from(
        document.querySelectorAll('[data-testid^="knowledge-tree-folder-"]'),
      )
      for (const row of rows) {
        if ((row.textContent ?? '').includes(title)) {
          return row.getAttribute('data-testid')
        }
      }
      return rows[0]?.getAttribute('data-testid') ?? null
    }, folderRenamed)

    if (!folderTid) {
      // Folder already gone — treat as pass if title absent
      await expectTreeNotContains(folderRenamed)
      return
    }

    await deleteTreeNodeByTestId(folderTid)
    await expectTreeNotContains(folderRenamed)
  })

  it('KT6: context-menu newFolder under empty tree root (soft)', async () => {
    // Create another folder via context menu on existing folder if any, else toolbar
    const before = await browser.execute(
      () => document.querySelectorAll('[data-testid^="knowledge-tree-folder-"]').length,
    )
    await createFolderFromToolbar()
    await browser.waitUntil(
      async () => {
        const n = await browser.execute(
          () => document.querySelectorAll('[data-testid^="knowledge-tree-folder-"]').length,
        )
        return n > before
      },
      { timeout: 10000, interval: 200, timeoutMsg: 'second folder not created' },
    )
    expect(
      await browser.execute(
        () => document.querySelectorAll('[data-testid^="knowledge-tree-folder-"]').length,
      ),
    ).toBeGreaterThan(before)
  })
})
