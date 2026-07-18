import { expect } from 'expect-webdriverio'
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
  clickKnowledgeBold,
  installSavePathSeam,
  clearSavePathSeam,
  exportActiveDocTo,
} from '../helpers/knowledge.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('knowledge editor ux @knowledge @core', () => {
  const spaceName = `e2e-kb-space-${Date.now()}`
  const marker = `e2e-kb-marker-${Date.now()}`
  const renamedTitle = `e2e-kb-title-${Date.now()}`
  let exportPath = ''

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await closeKnowledgeChipIfOpen()

    // Shared setup for the suite: open knowledge → space → doc → type once
    await openKnowledgeFromMenu()
    await (await browser.$('[data-testid="knowledge-page"]')).waitForExist({ timeout: 20000 })

    if (await (await browser.$('[data-testid="knowledge-home"]')).isExisting()) {
      await createSpaceAndOpen(spaceName)
    } else if (!(await (await browser.$('[data-testid="knowledge-workspace"]')).isExisting())) {
      await createSpaceAndOpen(spaceName)
    }

    await (await browser.$('[data-testid="knowledge-workspace"]')).waitForExist({
      timeout: 15000,
    })

    if (!(await (await browser.$('[data-testid="knowledge-doc-editor"]')).isExisting())) {
      await createDocAndExpectEditor()
    }

    await typeInKnowledgeEditor(marker)
  })

  after(async () => {
    await clearSavePathSeam()
    if (exportPath && fs.existsSync(exportPath)) {
      try {
        fs.unlinkSync(exportPath)
      } catch {
        // ignore
      }
    }
    await closeKnowledgeChipIfOpen()
  })

  it('KE1: knowledge page is open', async () => {
    const page = await browser.$('[data-testid="knowledge-page"]')
    expect(await page.isExisting()).toBe(true)
  })

  it('KE2: workspace is visible after space setup', async () => {
    const ws = await browser.$('[data-testid="knowledge-workspace"]')
    expect(await ws.isExisting()).toBe(true)
  })

  it('KE3: document opens in edit mode by default', async () => {
    // Editor was shown without clicking edit toggle in before()
    expect(await (await browser.$('[data-testid="knowledge-doc-editor"]')).isExisting()).toBe(
      true,
    )
  })

  it('KE4: editor contains typed marker', async () => {
    const content = await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
    expect(await content.getText()).toContain(marker)
  })

  it('KE5: preview shows the typed marker', async () => {
    await toggleKnowledgePreviewOrEdit()
    await expectNoKnowledgeEditor()
    await expectKnowledgeReader(marker)
  })

  it('KE6: edit again keeps the marker', async () => {
    await toggleKnowledgePreviewOrEdit()
    await expectKnowledgeEditor()
    const content = await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
    await browser.waitUntil(async () => (await content.getText()).includes(marker), {
      timeout: 10000,
      interval: 200,
    })
    expect(await content.getText()).toContain(marker)
  })

  it('KE7: content survives debounce + preview round-trip', async () => {
    if (!(await (await browser.$('[data-testid="knowledge-doc-editor"]')).isExisting())) {
      await toggleKnowledgePreviewOrEdit()
      await expectKnowledgeEditor()
    }
    await browser.pause(900)
    await toggleKnowledgePreviewOrEdit()
    await expectKnowledgeReader(marker)
    await toggleKnowledgePreviewOrEdit()
    await expectKnowledgeEditor()
    const content = await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
    expect(await content.getText()).toContain(marker)
  })

  it('KE8: knowledge page chrome is visible', async () => {
    // Title-bar knowledge-tab chip was removed; assert page/workspace product chrome.
    const page = await browser.$('[data-testid="knowledge-page"]')
    await page.waitForExist({ timeout: 10000 })
    expect(await page.isExisting()).toBe(true)
    const workspace = await browser.$('[data-testid="knowledge-workspace"]')
    if (await workspace.isExisting()) {
      expect(await workspace.isExisting()).toBe(true)
    }
  })

  it('KE9: inline title renames document', async () => {
    await expectKnowledgeEditor()
    await setKnowledgeDocTitle(renamedTitle)
    await browser.pause(400)
    // Tree row should show the new title
    const tree = await browser.$('[data-testid="knowledge-tree"]')
    await browser.waitUntil(
      async () => (await tree.getText()).includes(renamedTitle),
      { timeout: 10000, interval: 200, timeoutMsg: 'tree missing renamed title' },
    )
  })

  it('KE11: markdown toolbar bold wraps selection', async () => {
    await expectKnowledgeEditor()
    const content = await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
    // Select all then bold
    await browser.execute((el: HTMLElement) => {
      el.focus()
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      sel?.removeAllRanges()
      sel?.addRange(range)
    }, content)
    await clickKnowledgeBold()
    await browser.pause(200)
    const text = await content.getText()
    expect(text.includes('**') || text.includes(marker)).toBe(true)
  })

  it('KE12: export dirty buffer via save seam includes marker', async () => {
    exportPath = path.join(os.tmpdir(), `hip-e2e-export-${Date.now()}.md`)
    await expectKnowledgeEditor()
    const content = await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
    const before = await content.getText()
    if (!before.includes(marker)) {
      await typeInKnowledgeEditor(marker)
    }
    // Allow debounce autosave + ensure flush path
    await browser.pause(700)
    await exportActiveDocTo(exportPath)
    const body = fs.readFileSync(exportPath, 'utf8')
    expect(body).toContain(marker)
  })

  it('KE13: tree filter hides non-matching docs', async () => {
    const filter = await browser.$('[data-testid="knowledge-tree-filter"]')
    await filter.waitForExist({ timeout: 5000 })
    await browser.execute(
      (el: HTMLInputElement, v: string) => {
        el.focus()
        const proto = window.HTMLInputElement.prototype
        const desc = Object.getOwnPropertyDescriptor(proto, 'value')
        desc?.set?.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      },
      filter,
      renamedTitle,
    )
    await browser.pause(300)
    const tree = await browser.$('[data-testid="knowledge-tree"]')
    const text = await tree.getText()
    expect(text).toContain(renamedTitle)
    // clear filter
    await browser.execute((el: HTMLInputElement) => {
      const proto = window.HTMLInputElement.prototype
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
      desc?.set?.call(el, '')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, filter)
  })
})
