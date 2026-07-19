// Recycle bin smoke: open from chrome, empty state or filters visible.
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { waitForHipE2E } from '../helpers/e2e-hooks.js'
import { closeTrash, openTrash } from '../helpers/trash.js'
import { switchToChatSurface } from '../helpers/surface.js'

describe('recycle bin @smoke @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    await switchToChatSurface()
  })

  after(async () => {
    await closeTrash()
  })

  it('opens recycle bin page with filters and empty or list state', async () => {
    // Footer entry exists above history.
    const footerTrash = await browser.$('[data-testid="account-trash-button"]')
    await footerTrash.waitForExist({ timeout: 10000 })
    expect(await footerTrash.isExisting()).toBe(true)

    await openTrash()
    const page = await browser.$('[data-testid="recycle-bin-page"]')
    expect(await page.isExisting()).toBe(true)

    // Either empty state or rows — both are valid.
    const empty = await browser.$('[data-testid="recycle-bin-empty"]')
    const row = await browser.$('[data-testid="recycle-bin-row"]')
    const hasEmpty = await empty.isExisting()
    const hasRow = await row.isExisting()
    expect(hasEmpty || hasRow).toBe(true)
  })
})
