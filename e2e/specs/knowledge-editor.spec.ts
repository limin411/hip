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
} from '../helpers/knowledge.js'

describe('knowledge editor ux @knowledge @core', () => {
  const spaceName = `e2e-kb-space-${Date.now()}`
  const marker = `e2e-kb-marker-${Date.now()}`

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

  it('KE8: knowledge tab chip is visible', async () => {
    const tab = await browser.$('[data-testid="knowledge-tab"]')
    await tab.waitForExist({ timeout: 10000 })
    expect(await tab.isExisting()).toBe(true)
  })
})
