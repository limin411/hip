/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import {
  KnowledgeBoardCanvas,
  type KnowledgeBoardCanvasHandle,
} from './KnowledgeBoardCanvas'
import {
  EMPTY_BOARD_SCENE_JSON,
  assertNoDataUrlInBoardJson,
  buildDiskScene,
  stableSerializeBoard,
  type HipBoardSceneDisk,
} from '@/domain/knowledge/boardScene'

/** Non-empty dehydrated scene for pre-hydrate flush regression. */
const LOADED_BOARD_JSON = stableSerializeBoard({
  type: 'excalidraw',
  version: 2,
  source: 'hip',
  hip: { schemaVersion: 1, boardId: 'brd_testboard01' },
  elements: [
    { id: 'stroke1', type: 'freedraw', points: [[0, 0], [1, 1]] },
    { id: 'img1', type: 'image', fileId: 'file_ok' },
  ],
  appState: { viewBackgroundColor: '#abcdef' },
  files: {
    file_ok: {
      id: 'file_ok',
      mimeType: 'image/png',
      created: 99,
      hipAssetRel: 'assets/ast_ok.png',
    },
  },
} satisfies HipBoardSceneDisk)

const setDraftBody = vi.fn()
const hydrateBoardFiles = vi.fn()
const importBoardFileBytes = vi.fn()
const toastWarning = vi.fn()
const toastError = vi.fn()

let lastOnChange:
  | ((
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>,
    ) => void)
  | null = null

vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: Object.assign(
    (sel: (s: { activeDocId: string | null }) => unknown) =>
      sel({ activeDocId: 'brd_testboard01' }),
    {
      getState: () => ({
        activeDocId: 'brd_testboard01',
        setDraftBody: (...args: unknown[]) => setDraftBody(...args),
      }),
    },
  ),
}))

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

vi.mock('sonner', () => ({
  toast: {
    warning: (...a: unknown[]) => toastWarning(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en' },
  }),
}))

vi.mock('./excalidrawLazy', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as typeof import('react')
  const MockExcalidraw = (props: {
    onChange?: (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>,
    ) => void
    initialData?: unknown
  }) => {
    lastOnChange = props.onChange ?? null
    return React.createElement('div', {
      'data-testid': 'mock-excalidraw',
      'data-has-initial': props.initialData ? '1' : '0',
    })
  }
  return {
    LazyExcalidraw: MockExcalidraw,
    loadExcalidrawUtils: async () => ({
      exportToBlob: async () => new Blob(['png'], { type: 'image/png' }),
    }),
    ensureExcalidrawAssetPath: () => {},
  }
})

describe('KnowledgeBoardCanvas', () => {
  beforeEach(() => {
    setDraftBody.mockReset()
    hydrateBoardFiles.mockReset()
    importBoardFileBytes.mockReset()
    toastWarning.mockReset()
    toastError.mockReset()
    lastOnChange = null
    hydrateBoardFiles.mockResolvedValue({
      files: {},
      relByFileId: new Map(),
      failedIds: [],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hydrates and mounts with initial dehydrated JSON', async () => {
    const { getByTestId } = render(
      <KnowledgeBoardCanvas
        boardId="brd_testboard01"
        spaceId="spc_1"
        initialJson={EMPTY_BOARD_SCENE_JSON}
      />,
    )
    await waitFor(() => {
      expect(hydrateBoardFiles).toHaveBeenCalled()
      expect(getByTestId('knowledge-board-canvas')).toBeTruthy()
      expect(getByTestId('mock-excalidraw')).toBeTruthy()
    })
  })

  it('flushToStore leave drops pending imports, writes dehydrated draft, toasts', async () => {
    const ref = createRef<KnowledgeBoardCanvasHandle>()
    render(
      <KnowledgeBoardCanvas
        ref={ref}
        boardId="brd_testboard01"
        spaceId="spc_1"
        initialJson={EMPTY_BOARD_SCENE_JSON}
      />,
    )
    await waitFor(() => expect(lastOnChange).toBeTruthy())

    // Simulate paste of image that is still pending import (import never resolves).
    importBoardFileBytes.mockReturnValue(new Promise(() => {}))
    act(() => {
      lastOnChange?.(
        [
          { id: 'r1', type: 'rectangle' },
          { id: 'img1', type: 'image', fileId: 'file_pending' },
        ],
        { viewBackgroundColor: '#ffffff' },
        {
          file_pending: {
            id: 'file_pending',
            mimeType: 'image/png',
            created: 1,
            dataURL: 'data:image/png;base64,QUJD',
          },
        },
      )
    })

    setDraftBody.mockClear()
    act(() => {
      ref.current?.flushToStore({ mode: 'leave' })
    })

    expect(toastWarning).toHaveBeenCalledWith('knowledge.board.pendingImageDropped')
    expect(setDraftBody).toHaveBeenCalled()
    const [body, opts] = setDraftBody.mock.calls.at(-1)!
    expect(opts).toEqual({ docId: 'brd_testboard01', persist: 'none' })
    expect(() => assertNoDataUrlInBoardJson(body as string)).not.toThrow()
    const parsed = JSON.parse(body as string)
    expect(parsed.files).toEqual({})
    // pending image element stripped; stroke kept
    expect(parsed.elements.some((e: { id: string }) => e.id === 'r1')).toBe(true)
    expect(parsed.elements.some((e: { id: string }) => e.id === 'img1')).toBe(false)
  })

  it('flushToStore snapshot keeps pending without toast; draft has no dataURL', async () => {
    const ref = createRef<KnowledgeBoardCanvasHandle>()
    render(
      <KnowledgeBoardCanvas
        ref={ref}
        boardId="brd_testboard01"
        spaceId="spc_1"
        initialJson={EMPTY_BOARD_SCENE_JSON}
      />,
    )
    await waitFor(() => expect(lastOnChange).toBeTruthy())

    importBoardFileBytes.mockReturnValue(new Promise(() => {}))
    act(() => {
      lastOnChange?.(
        [
          { id: 'r1', type: 'freedraw' },
          { id: 'img1', type: 'image', fileId: 'file_pending' },
        ],
        { viewBackgroundColor: '#eee' },
        {
          file_pending: {
            id: 'file_pending',
            mimeType: 'image/png',
            created: 1,
            dataURL: 'data:image/png;base64,QUJD',
          },
        },
      )
    })

    setDraftBody.mockClear()
    toastWarning.mockClear()
    act(() => {
      ref.current?.flushToStore({ mode: 'snapshot' })
    })

    expect(toastWarning).not.toHaveBeenCalled()
    const [body, opts] = setDraftBody.mock.calls.at(-1)!
    expect(opts).toEqual({ docId: 'brd_testboard01', persist: 'none' })
    expect(() => assertNoDataUrlInBoardJson(body as string)).not.toThrow()
    const parsed = JSON.parse(body as string)
    // pending file not in dehydrated files map
    expect(parsed.files.file_pending).toBeUndefined()
    // strokes present; pending image element may remain in runtime elements for snapshot
    expect(parsed.elements.some((e: { id: string }) => e.id === 'r1')).toBe(true)
  })

  it('onChange throttle eventually setDraftBody with dehydrated only', async () => {
    render(
      <KnowledgeBoardCanvas
        boardId="brd_testboard01"
        spaceId="spc_1"
        initialJson={EMPTY_BOARD_SCENE_JSON}
      />,
    )
    await waitFor(() => expect(lastOnChange).toBeTruthy())
    setDraftBody.mockClear()
    vi.useFakeTimers()

    act(() => {
      lastOnChange?.(
        [{ id: 'stroke', type: 'freedraw', points: [[0, 0]] }],
        { viewBackgroundColor: '#fff' },
        {},
      )
    })

    expect(setDraftBody).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(setDraftBody).toHaveBeenCalled()
    const [body, opts] = setDraftBody.mock.calls.at(-1)!
    expect(opts).toMatchObject({ docId: 'brd_testboard01', persist: 'auto' })
    expect(() => assertNoDataUrlInBoardJson(body as string)).not.toThrow()
  })

  it('Issue 1: leave flush before hydrate resolves keeps loaded scene (not empty wipe)', async () => {
    // Hydrate hangs forever — refs must be sync-seeded from parseBoardScene.
    hydrateBoardFiles.mockReturnValue(new Promise(() => {}))

    const ref = createRef<KnowledgeBoardCanvasHandle>()
    render(
      <KnowledgeBoardCanvas
        ref={ref}
        boardId="brd_testboard01"
        spaceId="spc_1"
        initialJson={LOADED_BOARD_JSON}
      />,
    )

    // Still loading UI; flush must work from sync-seeded refs (useLayoutEffect).
    setDraftBody.mockClear()
    act(() => {
      ref.current?.flushToStore({ mode: 'leave' })
    })

    expect(setDraftBody).toHaveBeenCalled()
    const [body, opts] = setDraftBody.mock.calls.at(-1)!
    expect(opts).toEqual({ docId: 'brd_testboard01', persist: 'none' })
    expect(() => assertNoDataUrlInBoardJson(body as string)).not.toThrow()

    const parsed = JSON.parse(body as string) as HipBoardSceneDisk
    // Must NOT be empty wipe of a real board.
    expect(parsed.elements.length).toBeGreaterThan(0)
    expect(parsed.elements.some((e) => (e as { id: string }).id === 'stroke1')).toBe(
      true,
    )
    expect(parsed.files.file_ok?.hipAssetRel).toBe('assets/ast_ok.png')
    expect(parsed.appState.viewBackgroundColor).toBe('#abcdef')
    // Still dehydrated — no dataURL in files map.
    expect(parsed.files.file_ok).not.toHaveProperty('dataURL')
  })

  it('Issue 2: after leave, onChange cannot re-enqueue imports or auto-draft', async () => {
    const ref = createRef<KnowledgeBoardCanvasHandle>()
    render(
      <KnowledgeBoardCanvas
        ref={ref}
        boardId="brd_testboard01"
        spaceId="spc_1"
        initialJson={EMPTY_BOARD_SCENE_JSON}
      />,
    )
    await waitFor(() => expect(lastOnChange).toBeTruthy())

    importBoardFileBytes.mockReturnValue(new Promise(() => {}))
    act(() => {
      lastOnChange?.(
        [
          { id: 'r1', type: 'rectangle' },
          { id: 'img1', type: 'image', fileId: 'file_pending' },
        ],
        { viewBackgroundColor: '#ffffff' },
        {
          file_pending: {
            id: 'file_pending',
            mimeType: 'image/png',
            created: 1,
            dataURL: 'data:image/png;base64,QUJD',
          },
        },
      )
    })
    // Serial import queue is microtask-scheduled.
    await waitFor(() => expect(importBoardFileBytes).toHaveBeenCalledTimes(1))

    setDraftBody.mockClear()
    importBoardFileBytes.mockClear()
    toastWarning.mockClear()

    act(() => {
      ref.current?.flushToStore({ mode: 'leave' })
    })
    expect(toastWarning).toHaveBeenCalledWith('knowledge.board.pendingImageDropped')
    const leaveCallCount = setDraftBody.mock.calls.length
    expect(leaveCallCount).toBeGreaterThanOrEqual(1)

    // Excalidraw still mounted and may fire onChange with the same BinaryFiles.
    setDraftBody.mockClear()
    act(() => {
      lastOnChange?.(
        [
          { id: 'r1', type: 'rectangle' },
          { id: 'img1', type: 'image', fileId: 'file_pending' },
        ],
        { viewBackgroundColor: '#ffffff' },
        {
          file_pending: {
            id: 'file_pending',
            mimeType: 'image/png',
            created: 1,
            dataURL: 'data:image/png;base64,QUJD',
          },
        },
      )
    })
    // Flush any microtasks that would have re-enqueued.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(importBoardFileBytes).not.toHaveBeenCalled()
    // No auto draft after freeze (leave already wrote persist:none).
    expect(setDraftBody).not.toHaveBeenCalled()
  })
})

describe('boardScene dehydrate invariant helpers (canvas unit support)', () => {
  it('buildDiskScene never serializes dataURL keys', () => {
    const raw = stableSerializeBoard(
      buildDiskScene({
        elements: [],
        appState: {},
        relByFileId: new Map([['f', 'assets/a.png']]),
        runtimeFiles: {
          f: {
            id: 'f',
            mimeType: 'image/png',
            created: 1,
            dataURL: 'data:image/png;base64,xx',
          },
        },
      }),
    )
    expect(() => assertNoDataUrlInBoardJson(raw)).not.toThrow()
    expect(JSON.parse(raw).files.f).not.toHaveProperty('dataURL')
  })
})
