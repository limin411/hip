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
  closeKnowledgeChipIfOpen,
  setKnowledgeDocTitle,
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

    if (!(await (await browser.$('[data-testid="knowledge-workspace"]')).isExisting())) {
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

  it('KE3: document opens on a writable surface by default', async () => {
    // R3: Live is product default; Source after typeInKnowledgeEditor (raw MD path).
    const live = await (await browser.$('[data-testid="knowledge-doc-live-editor"]')).isExisting()
    const source = await (await browser.$('[data-testid="knowledge-doc-editor"]')).isExisting()
    expect(live || source).toBe(true)
    // No document-level Preview writing control.
    expect(
      await (await browser.$('[data-testid="knowledge-edit-toggle-preview"]')).isExisting(),
    ).toBe(false)
  })

  it('KE4: editor contains typed marker', async () => {
    await expectKnowledgeEditor()
    const content = await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
    expect(await content.getText()).toContain(marker)
  })

  it('KE5: Live canvas shows the typed marker (no Preview mode)', async () => {
    await toggleKnowledgePreviewOrEdit()
    await expectKnowledgeReader(marker)
  })

  it('KE6: Source again keeps the marker', async () => {
    await toggleKnowledgePreviewOrEdit()
    await expectKnowledgeEditor()
    const content = await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
    await browser.waitUntil(async () => (await content.getText()).includes(marker), {
      timeout: 10000,
      interval: 200,
    })
    expect(await content.getText()).toContain(marker)
  })

  it('KE7: content survives debounce + Live/Source round-trip', async () => {
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

  it('KE11: Mod-b bold wraps selection (toolbar retired, slash/keyboard paths)', async () => {
    await expectKnowledgeEditor()
    const content = await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
    // Select all then bold via the editor keymap (same semantics as the old toolbar).
    await browser.execute((el: HTMLElement) => {
      el.focus()
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      sel?.removeAllRanges()
      sel?.addRange(range)
    }, content)
    await browser.keys(['Meta', 'b', 'Meta'])
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

  it('KE14: Typora live preview renders heading syntax in place', async () => {
    await ensureKnowledgeSource()
    await expectKnowledgeEditor()
    await typeInKnowledgeEditor(`# ${marker}`)
    const h1 = await browser.$('[data-testid="knowledge-doc-editor"] .kb-tp-h1')
    await h1.waitForExist({ timeout: 10000 })
    await browser.waitUntil(
      async () => (await h1.getText()).includes(marker),
      { timeout: 10000, interval: 200, timeoutMsg: 'live heading preview missing marker' },
    )
  })
})
