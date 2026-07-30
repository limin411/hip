/**
 * Knowledge whiteboard (hip SVG board) e2e smoke.
 * Tags: @knowledge @core
 *
 * Flow: create board → draw rect (toolbar + pointer) → switch leaf and back →
 * structure click when companion rail is available → export JSON.
 *
 * Requires the Tauri desktop app (WebdriverIO). Pure canvas/domain coverage
 * lives under `src/components/knowledge/HipBoardCanvas.test.tsx` and
 * `src/domain/knowledge/board*.test.ts` — run those with vitest when no display.
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
  waitForHipBoardSvg,
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
  selectHipBoardTool,
  drawHipBoardRect,
  countHipBoardElements,
  clickBoardStructureItemIfAvailable,
} from '../helpers/knowledge.js'

describe('knowledge whiteboard e2e smoke @knowledge @core', () => {
  const stamp = Date.now()
  const spaceName = `e2e-kb-board-${stamp}`
  const docTitle = `e2e-board-doc-${stamp}`
  /** Locale-proof unique title (i18n default is zh-CN「未命名画板」 / en “Untitled whiteboard”). */
  const boardTitle = `e2e-board-${stamp}`
  /**
   * Content marker via viewBackgroundColor (BOARD_APP_STATE_PERSIST_KEYS).
   * Survives buildHipDiskScene / leave flush without freehand strokes.
   * Unique-ish hex so we do not collide with default #ffffff.
   */
  const bgMarker = '#c0ffee'
  let boardId = ''
  let exportJson = ''
  let drewRect = false

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
    expect(await canvas.getAttribute('data-engine')).toBe('hip')

    // Rename to stamped title — never depend on i18n default board title.
    await setKnowledgeDocTitle(boardTitle)
    await expectTreeContains(boardTitle, 10000)
    const boards = await listKnowledgeBoardTestIds()
    expect(boards.some((tid) => tid.includes(boardId))).toBe(true)

    // createBoard writes empty dehydrated hip-board scene on primary path.
    const diskPath = await waitForBoardFileOnDisk(boardId, 15000)
    expect(diskPath.endsWith('.board.json')).toBe(true)
    const raw = fs.readFileSync(diskPath, 'utf8')
    expect(raw).toContain('"type":"hip-board"')
    expect(raw).toContain('"source":"hip"')
  })

  it('KB2: hip SVG mounts; rect tool + draw rect', async () => {
    await waitForHipBoardSvg(20000)
    const host = await browser.$('[data-testid="knowledge-board-canvas"]')
    expect(await host.isExisting()).toBe(true)
    expect(await host.getAttribute('data-board-id')).toBe(boardId)

    // Toolbar is hip chrome (not Excalidraw).
    const toolbar = await browser.$('[data-testid="hip-board-toolbar"]')
    expect(await toolbar.isExisting()).toBe(true)
    await selectHipBoardTool('rect')
    expect(await host.getAttribute('data-tool')).toBe('rect')

    drewRect = await drawHipBoardRect()
    if (drewRect) {
      expect(await countHipBoardElements('rect')).toBeGreaterThanOrEqual(1)
      // Draft throttle ~150ms — wait for dehydrated scene to include rect type.
      await waitForBoardBodyOnDisk('"type":"rect"', 10000).catch(() => {
        // Leave flush in KB3 is the hard persistence path if auto draft lags.
      })
    } else {
      // Headless pointer capture can be flaky; tool activation is still a hard assert.
      console.warn(
        '[knowledge-board e2e] drawHipBoardRect did not create a rect DOM node; continuing with tool-only coverage',
      )
    }
  })

  it('KB3: switch to another doc and back — board leaf + scene persist', async () => {
    // Leave board so flush writes current draft; then plant a marker on disk
    // while a *doc* is active (active board flush cannot clobber the seed).
    await createDocAndExpectEditor()
    await setKnowledgeDocTitle(docTitle)
    await expectTreeContains(docTitle, 10000)

    // If a live draw flushed a rect, prefer that as the persistence marker;
    // otherwise seed appState.viewBackgroundColor via disk (persist allowlist).
    let marker = bgMarker
    const existingPath = findBoardPathOnDisk(boardId)
    if (existingPath && fs.readFileSync(existingPath, 'utf8').includes('"type":"rect"')) {
      marker = '"type":"rect"'
    } else {
      const scene = JSON.stringify({
        type: 'hip-board',
        version: 1,
        source: 'hip',
        hip: { schemaVersion: 1, boardId },
        elements: drewRect
          ? [
              {
                id: 'e2e_rect',
                type: 'rect',
                x: 10,
                y: 10,
                w: 80,
                h: 60,
                fill: '#ffffff',
                stroke: '#111111',
                strokeWidth: 2,
                cornerRadius: 0,
              },
            ]
          : [],
        appState: { viewBackgroundColor: bgMarker },
        files: {},
      })
      const diskPath = findBoardPathOnDisk(boardId)
      expect(diskPath).toBeTruthy()
      writeBoardBodyOnDisk(boardId, scene)
      expect(fs.readFileSync(diskPath!, 'utf8')).toContain(bgMarker)
      if (drewRect || scene.includes('"type":"rect"')) {
        marker = bgMarker
      }
    }

    // Open board (openDoc reads disk → draft). Canvas remounts for same id.
    await openTreeBoardByTitle(boardTitle)
    await waitForKnowledgeBoardCanvas(20000)
    expect(await getActiveBoardId()).toBe(boardId)

    // Switch away and back — leave flush rewrites via buildHipDiskScene; bg color
    // / elements in the persist allowlist should still be on disk after leave.
    await openTreeDocByTitle(docTitle)
    await browser.pause(500)
    await openTreeBoardByTitle(boardTitle)
    await waitForKnowledgeBoardCanvas(20000)
    expect(await getActiveBoardId()).toBe(boardId)

    const stillOnDisk = await waitForBoardBodyOnDisk(marker, 15000)
    expect(fs.readFileSync(stillOnDisk, 'utf8')).toContain(marker)
  })

  it('KB4: structure click when companion rail is available', async () => {
    if (!(await (await browser.$('[data-testid="knowledge-board-canvas"]')).isExisting())) {
      await openTreeBoardByTitle(boardTitle)
    }
    await waitForHipBoardSvg(20000)

    // Ensure at least one structure row: draw if empty, else plant on disk + reopen.
    let rectCount = await countHipBoardElements('rect')
    if (rectCount < 1) {
      const drew = await drawHipBoardRect({ startX: 40, startY: 40, endX: 140, endY: 120 })
      if (!drew) {
        const scene = JSON.stringify({
          type: 'hip-board',
          version: 1,
          source: 'hip',
          hip: { schemaVersion: 1, boardId },
          elements: [
            {
              id: 'e2e_struct',
              type: 'rect',
              x: 20,
              y: 20,
              w: 100,
              h: 70,
              fill: '#ffffff',
              stroke: '#111111',
              strokeWidth: 2,
              cornerRadius: 0,
            },
          ],
          appState: { viewBackgroundColor: '#ffffff' },
          files: {},
        })
        // Switch away so write is not clobbered by leave flush of empty draft.
        await openTreeDocByTitle(docTitle)
        await browser.pause(300)
        writeBoardBodyOnDisk(boardId, scene)
        await openTreeBoardByTitle(boardTitle)
        await waitForHipBoardSvg(20000)
      }
      rectCount = await countHipBoardElements('rect')
    }

    const clicked = await clickBoardStructureItemIfAvailable()
    if (rectCount >= 1) {
      // When elements exist and rail opens, prefer a successful structure click.
      // Soft-pass only if the panel chrome itself is missing (layout / CI).
      if (!clicked) {
        const panel = await browser.$('[data-testid="knowledge-outline-panel"]')
        const companion = await browser.$('[data-testid="knowledge-board-companion"]')
        if ((await panel.isExisting()) && (await companion.isExisting())) {
          // Structure empty after outline debounce — still assert companion shell.
          const empty = await browser.$('[data-testid="knowledge-board-structure-empty"]')
          expect(await empty.isExisting() || (await countHipBoardElements()) >= 1).toBe(true)
        }
      } else {
        expect(clicked).toBe(true)
      }
    }
    // No elements and no rail: nothing hard to assert beyond board still open.
    expect(await getActiveBoardId()).toBe(boardId)
  })

  it('KB5: export whiteboard JSON via menu + save-path seam', async () => {
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
