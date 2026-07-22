import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToChatSurface, switchToCodeSurface } from '../helpers/surface.js'
import { CodePage } from '../page-objects/CodePage.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')
const codePage = new CodePage()
let chat: ChatPage

async function typeInComposer(text: string): Promise<void> {
  const ta = await chat.activeTextarea
  await ta.waitForExist({ timeout: 10000 })
  await ta.click()
  await ta.clearValue()
  await browser.keys(text)
}

describe('file mention @ @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    chat = new ChatPage()
  })

  it('does not open file palette on chat surface (no project root)', async () => {
    await switchToChatSurface()
    await typeInComposer('@')
    await browser.pause(400)
    const palette = await browser.$('[data-testid="file-mention-palette"]')
    expect(await palette.isExisting()).toBe(false)
  })

  it('shows hint-only palette when @ is typed with a project folder', async () => {
    await switchToCodeSurface()
    await codePage.pickDirectory(FIXTURE)
    await codePage.folderChip.waitForExist({ timeout: 30000 })

    await typeInComposer('@')
    await browser.pause(400)

    const palette = await browser.$('[data-testid="file-mention-palette"]')
    await palette.waitForExist({ timeout: 10000 })
    await expect(palette).toBeDisplayed()
    await expect(browser.$('[data-testid="file-mention-hint"]')).toBeDisplayed()
  })

  it('searches and selects a file into the composer with an attachment chip', async () => {
    await switchToCodeSurface()
    await codePage.pickDirectory(FIXTURE)
    await codePage.folderChip.waitForExist({ timeout: 30000 })

    await typeInComposer('@README')
    await browser.pause(500)

    const palette = await browser.$('[data-testid="file-mention-palette"]')
    await palette.waitForExist({ timeout: 10000 })

    await browser.waitUntil(
      async () => (await browser.$('[data-testid="file-mention-hit-0"]')).isExisting(),
      { timeout: 15000, interval: 200 },
    )

    const hit = await browser.$('[data-testid="file-mention-hit-0"]')
    const dataPath = await hit.getAttribute('data-path')
    expect(dataPath).toMatch(/README/i)

    await hit.click()
    await browser.pause(300)

    const ta = await chat.activeTextarea
    const value = await ta.getValue()
    expect(value).toMatch(/@README\.md\s/)

    await browser.waitUntil(
      async () => (await chat.attachmentChips).length >= 1,
      { timeout: 10000, interval: 200 },
    )
  })

  it('Escape dismisses the palette and strips the @ token', async () => {
    await switchToCodeSurface()
    await codePage.pickDirectory(FIXTURE)
    await codePage.folderChip.waitForExist({ timeout: 30000 })

    await typeInComposer('see @READ')
    await browser.pause(400)
    await (await browser.$('[data-testid="file-mention-palette"]')).waitForExist({ timeout: 10000 })

    await browser.keys('Escape')
    await browser.pause(300)

    const palette = await browser.$('[data-testid="file-mention-palette"]')
    if (await palette.isExisting()) {
      expect(await palette.isDisplayed()).toBe(false)
    }
    const value = await (await chat.activeTextarea).getValue()
    expect(value).toBe('see ')
  })

  it('slash palette takes priority over file mention', async () => {
    await switchToCodeSurface()
    await codePage.pickDirectory(FIXTURE)
    await codePage.folderChip.waitForExist({ timeout: 30000 })

    await typeInComposer('/')
    await browser.pause(400)
    await expect(chat.slashPalette).toBeDisplayed()
    const filePalette = await browser.$('[data-testid="file-mention-palette"]')
    expect(await filePalette.isExisting()).toBe(false)
  })
})
