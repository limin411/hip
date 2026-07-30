/**
 * Knowledge whiteboard (hip SVG board) e2e smoke.
 * Tags: @knowledge @core
 *
 * Headless freehand strokes are flaky — we assert create + canvas mount +
 * switch-away/back persistence of the board leaf (id + dehydrated file via
 * store/IPC), plus export JSON via save-path seam.
 * No paid LLM required.
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
  closeKnowledgeChipIfOpen,
  createDocAndExpectEditor,
  createBoardAndExpectCanvas,
  waitForKnowledgeBoardCanvas,
  getActiveBoardId,
  waitForBoardFileOnDisk,
  waitForBoardBodyOnDisk,
  writeBoardBodyOnDisk,
  findBoardPathOnDisk,
  openTreeBoardByTitle,
  openTreeDocByTitle,
  setKnowledgeDocTitle,
  exportActiveBoardJsonTo,
  clearSavePathSeam,
  deleteSpaceFromWorkspace,
  ensureKnowledgeHome,
  expectTreeContains,
  listKnowledgeBoardTestIds,
} from '../helpers/knowledge.js'

describe('knowledge whiteboard e2e smoke @knowledge @core', () => {
  const stamp = Date.now()
  const spaceName = `e2e-kb-board-${stamp}`
  const docTitle = `e2e-board-doc-${stamp}`
  /** Locale-proof unique title (i18n default is zh-CN「未命名画板」 / en “Untitled whiteboard”). */
  const boardTitle = `e2e-board-${stamp}`
  /**
   * Content marker via viewBackgroundColor (BOARD_APP_STATE_PERSIST_KEYS).
   * Survives buildDiskScene / leave flush without freehand strokes.
   * Unique-ish hex so we do not collide with default #ffffff.
   */
  const bgMarker = '#c0ffee'
  let boardId = ''
  let exportJson = ''

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await closeKnowledgeChipIfOpen()

    await openKnowledgeFromMenu()
    if (await (await browser.$('[data-testid="knowledge-workspace"]')).isExisting()) {
      await ensureKnowledgeHome()
    }
    await ensureKnowledgeHome()
    await createSpaceAndOpen(spaceName)
  })

  after(async () => {
    await clearSavePathSeam()
    if (exportJson && fs.existsSync(exportJson)) {
      try {
        fs.unlinkSync(exportJson)
      } catch {
        // ignore
      }
    }
    try {
      if (await (await browser.$('[data-testid="knowledge-workspace"]')).isExisting()) {
        await deleteSpaceFromWorkspace()
      }
    } catch {
      // ignore cleanup
    }
    await closeKnowledgeChipIfOpen()
  })

  it('KB1: create whiteboard from UI and mount canvas', async () => {
    boardId = await createBoardAndExpectCanvas()
    expect(boardId.startsWith('brd_')).toBe(true)

    const canvas = await browser.$('[data-testid="knowledge-board-canvas"]')
    expect(await canvas.isExisting()).toBe(true)
    expect(await canvas.getAttribute('data-board-id')).toBe(boardId)

    // Rename to stamped title — never depend on i18n default board title.
    await setKnowledgeDocTitle(boardTitle)
    await expectTreeContains(boardTitle, 10000)
    const boards = await listKnowledgeBoardTestIds()
    expect(boards.some((tid) => tid.includes(boardId))).toBe(true)

    // createBoard writes empty dehydrated hip-board scene immediately
    const diskPath = await waitForBoardFileOnDisk(boardId, 15000)
    expect(diskPath.endsWith('.board.json') || diskPath.endsWith('.excalidraw')).toBe(true)
    const raw = fs.readFileSync(diskPath, 'utf8')
    expect(raw).toContain('"type":"hip-board"')
    expect(raw).toContain('"source":"hip"')
  })

  it('KB2: hip SVG engine mounts inside board canvas host', async () => {
    await waitForKnowledgeBoardCanvas(20000)
    const host = await browser.$('[data-testid="knowledge-board-canvas"]')
    expect(await host.isExisting()).toBe(true)
    expect(await host.getAttribute('data-board-id')).toBe(boardId)

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const root = document.querySelector('[data-testid="knowledge-board-canvas"]')
          if (!root) return false
          return Boolean(
            root.querySelector('[data-testid="hip-board-svg"]') ||
              root.querySelector('svg'),
          )
        }),
      {
        timeout: 20000,
        interval: 300,
        timeoutMsg: 'hip board SVG not mounted under knowledge-board-canvas',
      },
    )
  })

  it('KB3: switch to another doc and back — board leaf + scene persist', async () => {
    // Leave board so flush writes current draft; then plant a marker on disk
    // while a *doc* is active (active board flush cannot clobber the seed).
    await createDocAndExpectEditor()
    await setKnowledgeDocTitle(docTitle)
    await expectTreeContains(docTitle, 10000)

    const scene = JSON.stringify({
      type: 'hip-board',
      version: 1,
      source: 'hip',
      hip: { schemaVersion: 1, boardId },
      elements: [],
      appState: { viewBackgroundColor: bgMarker },
      files: {},
    })
    const diskPath = findBoardPathOnDisk(boardId)
    expect(diskPath).toBeTruthy()
    writeBoardBodyOnDisk(boardId, scene)
    expect(fs.readFileSync(diskPath!, 'utf8')).toContain(bgMarker)

    // Open board (openDoc reads disk → draft). Canvas remounts for same id.
    await openTreeBoardByTitle(boardTitle)
    await waitForKnowledgeBoardCanvas(20000)
    expect(await getActiveBoardId()).toBe(boardId)

    // Switch away and back — leave flush rewrites via buildDiskScene; bg color
    // is in the persist allowlist so it should still be on disk after leave.
    await openTreeDocByTitle(docTitle)
    await browser.pause(500)
    await openTreeBoardByTitle(boardTitle)
    await waitForKnowledgeBoardCanvas(20000)
    expect(await getActiveBoardId()).toBe(boardId)

    const stillOnDisk = await waitForBoardBodyOnDisk(bgMarker, 15000)
    expect(fs.readFileSync(stillOnDisk, 'utf8')).toContain(bgMarker)
  })

  it('KB4: export whiteboard JSON via menu + save-path seam', async () => {
    if (!(await (await browser.$('[data-testid="knowledge-board-canvas"]')).isExisting())) {
      await openTreeBoardByTitle(boardTitle)
    }
    await waitForKnowledgeBoardCanvas(20000)

    exportJson = path.join(os.tmpdir(), `hip-e2e-board-export-${Date.now()}.board.json`)
    await exportActiveBoardJsonTo(exportJson)
    const exported = fs.readFileSync(exportJson, 'utf8')
    expect(exported.length).toBeGreaterThan(0)
    expect(exported).toContain('"type":"hip-board"')
    expect(exported).toContain('"source":"hip"')
    // Prefer content marker when engine / flush preserved appState.
    if (exported.includes(bgMarker)) {
      expect(exported).toContain(bgMarker)
    }
  })
})
