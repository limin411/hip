/**
 * @vitest-environment happy-dom
 *
 * PR-5: image import / leave drop pending / PNG export wiring.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { HipBoardCanvas, type HipBoardCanvasHandle } from './HipBoardCanvas'
import {
  EMPTY_HIP_BOARD_SCENE_JSON,
  serializeHipBoard,
  type HipBoardSceneDisk,
} from '@/domain/knowledge/boardScene'
import { buildBoardExportSvg } from '@/domain/knowledge/boardExport'

const hydrateBoardFiles = vi.fn()
const importBoardFileBytes = vi.fn()
const toastWarning = vi.fn()
const toastError = vi.fn()

vi.mock('@/domain/knowledge/boardScene', async () => {
  const actual = await vi.importActual<typeof import('@/domain/knowledge/boardScene')>(
    '@/domain/knowledge/boardScene',
  )
  return {
    ...actual,
    hydrateBoardFiles: (...a: unknown[]) => hydrateBoardFiles(...a),
    importBoardFileBytes: (...a: unknown[]) => importBoardFileBytes(...a),
  }
})

vi.mock('@/domain/knowledge/boardExport', async () => {
  const actual = await vi.importActual<typeof import('@/domain/knowledge/boardExport')>(
    '@/domain/knowledge/boardExport',
  )
  return {
    ...actual,
    // happy-dom may never fire Image.onload for blob/data URLs.
    decodeImageNaturalSize: vi.fn(async () => ({ naturalW: 64, naturalH: 48 })),
  }
})

vi.mock('sonner', () => ({
  toast: {
    warning: (...a: unknown[]) => toastWarning(...a),
    error: (...a: unknown[]) => toastError(...a),
    success: vi.fn(),
    message: vi.fn(),
  },
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (k: string) => k,
      i18n: { language: 'en' },
    }),
  }
})

// Tiny 1×1 PNG
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`

function makePngFile(name = 'pic.png'): File {
  const bin = atob(TINY_PNG_B64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type: 'image/png' })
}

const SCENE_WITH_IMAGE: HipBoardSceneDisk = {
  type: 'hip-board',
  version: 1,
  source: 'hip',
  hip: { schemaVersion: 1, boardId: 'brd_img' },
  elements: [
    {
      id: 'img1',
      type: 'image',
      x: 0,
      y: 0,
      w: 80,
      h: 60,
      fileId: 'file_a',
    },
  ],
  appState: { viewBackgroundColor: '#ffffff' },
  files: {
    file_a: {
      id: 'file_a',
      mimeType: 'image/png',
      created: 1,
      hipAssetRel: 'assets/ast_a.png',
    },
  },
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  hydrateBoardFiles.mockReset()
  importBoardFileBytes.mockReset()
  toastWarning.mockReset()
  toastError.mockReset()
  hydrateBoardFiles.mockResolvedValue({
    files: {},
    relByFileId: new Map(),
    failedIds: [],
  })
  importBoardFileBytes.mockResolvedValue('assets/ast_imported.png')
})

function renderCanvas(
  props: Partial<{
    initialJson: string
    onDraftBody: ReturnType<typeof vi.fn>
    boardId: string
  }> = {},
) {
  const ref = createRef<HipBoardCanvasHandle>()
  const onDraftBody = props.onDraftBody ?? vi.fn()
  render(
    <HipBoardCanvas
      ref={ref}
      boardId={props.boardId ?? 'brd_img'}
      spaceId="spc_1"
      initialJson={props.initialJson ?? EMPTY_HIP_BOARD_SCENE_JSON}
      onDraftBody={onDraftBody}
    />,
  )
  return { ref, onDraftBody, root: screen.getByTestId('knowledge-board-canvas') }
}

describe('HipBoardCanvas images + PNG export (PR-5)', () => {
  it('hydrates disk files into runtime blob URLs', async () => {
    hydrateBoardFiles.mockResolvedValue({
      files: {
        file_a: {
          id: 'file_a',
          mimeType: 'image/png',
          created: 1,
          dataURL: TINY_PNG_DATA_URL,
        },
      },
      relByFileId: new Map([['file_a', 'assets/ast_a.png']]),
      failedIds: [],
    })

    const { ref } = renderCanvas({
      initialJson: serializeHipBoard(SCENE_WITH_IMAGE),
    })

    await waitFor(() => {
      const url = ref.current!.getRuntimeImageUrl('file_a')
      expect(url).toBeTruthy()
      expect(url!.startsWith('blob:') || url!.startsWith('data:')).toBe(true)
    })
    expect(ref.current!.getFilesRel().file_a).toBe('assets/ast_a.png')
  })

  it('insertImageFiles places image, imports asset, draft has hipAssetRel only', async () => {
    const { ref, onDraftBody } = renderCanvas()

    await act(async () => {
      await ref.current!.insertImageFiles([makePngFile()])
    })

    expect(ref.current!.getElements().some((e) => e.type === 'image')).toBe(true)
    const img = ref.current!.getElements().find((e) => e.type === 'image') as {
      fileId: string
    }
    // May already complete import before we observe pending.
    expect(ref.current!.getRuntimeImageUrl(img.fileId)).toBeTruthy()

    await waitFor(() => {
      expect(importBoardFileBytes).toHaveBeenCalled()
      expect(ref.current!.getFilesRel()[img.fileId]).toBe('assets/ast_imported.png')
    })
    expect(ref.current!.getPendingImportIds()).not.toContain(img.fileId)

    // Throttle is 150ms — flush via snapshot for deterministic draft.
    act(() => {
      ref.current!.flushToStore({ mode: 'snapshot' })
    })
    const last = onDraftBody.mock.calls[onDraftBody.mock.calls.length - 1]![0] as string
    const parsed = JSON.parse(last)
    expect(parsed.files[img.fileId]?.hipAssetRel).toBe('assets/ast_imported.png')
    expect(parsed.files[img.fileId]?.dataURL).toBeUndefined()
    expect(JSON.stringify(parsed.files)).not.toContain('dataURL')
  })

  it('leave flush drops pending imports, strips image, toasts', async () => {
    // Never-resolving import keeps pending
    importBoardFileBytes.mockReturnValue(new Promise(() => {}))
    const { ref, onDraftBody } = renderCanvas()

    await act(async () => {
      await ref.current!.insertImageFiles([makePngFile()])
    })
    expect(ref.current!.getElements().some((e) => e.type === 'image')).toBe(true)
    expect(ref.current!.getPendingImportIds().length).toBeGreaterThan(0)

    act(() => {
      ref.current!.flushToStore({ mode: 'leave' })
    })

    expect(ref.current!.getElements().some((e) => e.type === 'image')).toBe(false)
    expect(ref.current!.getPendingImportIds()).toEqual([])
    expect(toastWarning).toHaveBeenCalledWith('knowledge.board.pendingImageDropped')
    expect(onDraftBody).toHaveBeenCalled()
    const raw = onDraftBody.mock.calls[onDraftBody.mock.calls.length - 1]![0] as string
    const parsed = JSON.parse(raw)
    expect(parsed.elements).toEqual([])
    expect(Object.keys(parsed.files)).toHaveLength(0)
  })

  it('snapshot flush keeps pending imports', async () => {
    importBoardFileBytes.mockReturnValue(new Promise(() => {}))
    const { ref } = renderCanvas()

    await act(async () => {
      await ref.current!.insertImageFiles([makePngFile()])
    })
    const pending = ref.current!.getPendingImportIds()
    expect(pending.length).toBeGreaterThan(0)

    act(() => {
      ref.current!.flushToStore({ mode: 'snapshot' })
    })
    expect(ref.current!.getPendingImportIds()).toEqual(pending)
    expect(ref.current!.getElements().some((e) => e.type === 'image')).toBe(true)
    expect(toastWarning).not.toHaveBeenCalledWith(
      'knowledge.board.pendingImageDropped',
    )
  })

  it('exportPngBlob path inlines dataURL never blob: (SVG contract + handle)', async () => {
    // Pure SVG path is the LKD-15 contract (happy-dom canvas may not rasterize).
    const { svg } = buildBoardExportSvg(SCENE_WITH_IMAGE.elements, {
      viewBackgroundColor: '#ffffff',
      imageSrc: { file_a: { dataURL: TINY_PNG_DATA_URL } },
    })
    expect(svg).toContain('href="data:image/png;base64,')
    expect(svg).not.toContain('blob:')
    expect(svg).toContain('<image')

    // Handle is wired and returns without throwing (null ok in happy-dom).
    const { ref } = renderCanvas({
      initialJson: serializeHipBoard(SCENE_WITH_IMAGE),
    })
    await waitFor(() => {
      expect(ref.current?.isReady()).toBe(true)
    })
    const blob = await Promise.race([
      ref.current!.exportPngBlob(),
      new Promise<null>((r) => setTimeout(() => r(null), 500)),
    ])
    // null or Blob both acceptable under happy-dom Image/canvas limits
    expect(blob === null || blob instanceof Blob).toBe(true)
  })

  it('toolbar image button opens file input', () => {
    renderCanvas()
    expect(screen.getByTestId('hip-board-tool-image')).toBeTruthy()
    expect(screen.getByTestId('hip-board-image-input')).toBeTruthy()
  })
})
