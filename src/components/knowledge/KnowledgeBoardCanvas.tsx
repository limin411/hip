/**
 * Knowledge whiteboard canvas — Excalidraw embed with KD-6 / KD-13 contracts.
 *
 * Invariants:
 * - Store draftBody is always dehydrated (hipAssetRel, never dataURL).
 * - Runtime BinaryFiles live only in component refs/state.
 * - flushToStore is 100% synchronous; leave drops pending imports + toast;
 *   snapshot keeps the import queue.
 */
import {
  forwardRef,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  assertNoDataUrlInBoardJson,
  buildDiskScene,
  EMPTY_BOARD_SCENE_JSON,
  estimateDataUrlBytes,
  hydrateBoardFiles,
  importBoardFileBytes,
  parseBoardScene,
  stableSerializeBoard,
  stripImageElementsForFiles,
  type HipBoardFilesRuntime,
  type HipBoardFileRuntime,
  type HipBoardSceneDisk,
} from '@/domain/knowledge/boardScene'
import { KNOWLEDGE_ASSET_INLINE_MAX_BYTES } from '@/domain/knowledge/limits'
import { isAllowedAssetMime, isImageMime } from '@/domain/knowledge/assetUrl'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { LazyExcalidraw, loadExcalidrawUtils } from './excalidrawLazy'

export type BoardFlushMode = 'snapshot' | 'leave'

export type FlushToStoreOpts = {
  /**
   * snapshot (default): stay on this board after the structural op — keep pending imports.
   * leave: active leaf will change or be destroyed — drop pending + toast.
   */
  mode?: BoardFlushMode
}

export type KnowledgeBoardCanvasHandle = {
  /**
   * 100% synchronous. mode 'leave' drops pending imports + toast;
   * mode 'snapshot' (default) keeps queue. Always setDraftBody dehydrated persist none.
   */
  flushToStore: (opts?: FlushToStoreOpts) => void
  exportPngBlob: () => Promise<Blob | null>
}

export type KnowledgeBoardCanvasProps = {
  boardId: string
  spaceId: string
  /** Dehydrated hip scene JSON from store (mount once; uncontrolled after). */
  initialJson: string
}

const THROTTLE_MS = 150

type ThemeMode = 'light' | 'dark'

function readDomTheme(): ThemeMode {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function isRuntimeFile(v: unknown): v is HipBoardFileRuntime {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.dataURL === 'string' && o.dataURL.length > 0
}

export const KnowledgeBoardCanvas = forwardRef<
  KnowledgeBoardCanvasHandle,
  KnowledgeBoardCanvasProps
>(function KnowledgeBoardCanvas({ boardId, spaceId, initialJson }, ref) {
  const { t, i18n } = useTranslation()

  const elementsRef = useRef<unknown[]>([])
  const appStateRef = useRef<Record<string, unknown>>({})
  const filesRef = useRef<HipBoardFilesRuntime>({})
  const relByFileIdRef = useRef<Map<string, string>>(new Map())
  /** fileIds with in-flight or queued asset import (no hipAssetRel yet). */
  const pendingImportRef = useRef<Set<string>>(new Set())
  const importSerialRef = useRef<Promise<void>>(Promise.resolve())
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRef = useRef(true)
  const boardIdRef = useRef(boardId)
  boardIdRef.current = boardId

  const [theme, setTheme] = useState<ThemeMode>(readDomTheme)
  const [hydrateReady, setHydrateReady] = useState(false)
  const [initialData, setInitialData] = useState<{
    elements: unknown[]
    appState: Record<string, unknown>
    files: HipBoardFilesRuntime
    scrollToContent: boolean
  } | null>(null)

  // Theme follows app dark class (same pattern as DocEditor / ToasterHost).
  useEffect(() => {
    const root = document.documentElement
    const sync = () => setTheme(readDomTheme())
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  // Mount: parse dehydrated JSON → hydrate BinaryFiles → initialData once.
  useEffect(() => {
    activeRef.current = true
    let cancelled = false

    ;(async () => {
      let scene: HipBoardSceneDisk
      try {
        scene = parseBoardScene(initialJson || EMPTY_BOARD_SCENE_JSON)
      } catch {
        scene = parseBoardScene(EMPTY_BOARD_SCENE_JSON)
      }

      const { files, relByFileId, failedIds } = await hydrateBoardFiles(
        spaceId,
        scene.files,
      )
      if (cancelled) return

      if (failedIds.length > 0) {
        toast.warning(t('knowledge.board.hydratePartial'))
      }

      elementsRef.current = scene.elements
      appStateRef.current = scene.appState
      filesRef.current = files
      relByFileIdRef.current = relByFileId
      pendingImportRef.current = new Set()

      setInitialData({
        elements: scene.elements,
        appState: { ...scene.appState },
        files,
        scrollToContent: true,
      })
      setHydrateReady(true)
    })()

    return () => {
      cancelled = true
      activeRef.current = false
      if (throttleTimerRef.current != null) {
        clearTimeout(throttleTimerRef.current)
        throttleTimerRef.current = null
      }
    }
    // Mount once per boardId (parent keys remount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, spaceId])

  const pushDraftAuto = useCallback(() => {
    if (!activeRef.current) return
    const id = boardIdRef.current
    if (useKnowledgeStore.getState().activeDocId !== id) return

    const disk = buildDiskScene({
      elements: elementsRef.current,
      appState: appStateRef.current,
      relByFileId: relByFileIdRef.current,
      runtimeFiles: filesRef.current,
      boardId: id,
    })
    const raw = stableSerializeBoard(disk)
    try {
      assertNoDataUrlInBoardJson(raw)
    } catch {
      return
    }
    useKnowledgeStore.getState().setDraftBody(raw, {
      docId: id,
      persist: 'auto',
    })
  }, [])

  const scheduleDraftAuto = useCallback(() => {
    if (throttleTimerRef.current != null) return
    throttleTimerRef.current = setTimeout(() => {
      throttleTimerRef.current = null
      pushDraftAuto()
    }, THROTTLE_MS)
  }, [pushDraftAuto])

  const enqueueImport = useCallback(
    (fileId: string, file: HipBoardFileRuntime) => {
      if (pendingImportRef.current.has(fileId)) return
      if (relByFileIdRef.current.has(fileId)) return

      const bytes = estimateDataUrlBytes(file.dataURL)
      if (bytes > KNOWLEDGE_ASSET_INLINE_MAX_BYTES) {
        // Drop oversize paste from runtime; do not leave dataURL in draft.
        const nextFiles = { ...filesRef.current }
        delete nextFiles[fileId]
        filesRef.current = nextFiles
        elementsRef.current = stripImageElementsForFiles(elementsRef.current, new Set([fileId]))
        toast.error(t('knowledge.asset.tooLargePaste'))
        scheduleDraftAuto()
        return
      }

      if (file.mimeType && !isAllowedAssetMime(file.mimeType) && !isImageMime(file.mimeType)) {
        const nextFiles = { ...filesRef.current }
        delete nextFiles[fileId]
        filesRef.current = nextFiles
        elementsRef.current = stripImageElementsForFiles(elementsRef.current, new Set([fileId]))
        toast.error(t('knowledge.asset.unsupported'))
        scheduleDraftAuto()
        return
      }

      pendingImportRef.current.add(fileId)
      const space = spaceId
      const board = boardIdRef.current

      importSerialRef.current = importSerialRef.current
        .then(async () => {
          if (!activeRef.current) return
          if (!pendingImportRef.current.has(fileId)) return
          if (useKnowledgeStore.getState().activeDocId !== board) return

          try {
            const rel = await importBoardFileBytes(space, file)
            if (!activeRef.current) return
            if (useKnowledgeStore.getState().activeDocId !== board) return
            if (!pendingImportRef.current.has(fileId)) return

            relByFileIdRef.current.set(fileId, rel)
            pendingImportRef.current.delete(fileId)
            // Keep runtime dataURL for Excalidraw display; draft uses rel only.
            pushDraftAuto()
          } catch {
            if (!activeRef.current) return
            pendingImportRef.current.delete(fileId)
            const nextFiles = { ...filesRef.current }
            delete nextFiles[fileId]
            filesRef.current = nextFiles
            elementsRef.current = stripImageElementsForFiles(
              elementsRef.current,
              new Set([fileId]),
            )
            toast.error(t('knowledge.asset.importFailed'))
            if (useKnowledgeStore.getState().activeDocId === board) {
              pushDraftAuto()
            }
          }
        })
        .catch(() => {
          /* serial chain must not break */
        })
    },
    [pushDraftAuto, scheduleDraftAuto, spaceId, t],
  )

  const onChange = useCallback(
    (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>,
    ) => {
      // A. EVERY call — so sync flush never misses strokes.
      elementsRef.current = elements as unknown[]
      appStateRef.current = appState

      const nextFiles: HipBoardFilesRuntime = { ...filesRef.current }
      for (const [id, f] of Object.entries(files ?? {})) {
        if (isRuntimeFile(f)) {
          nextFiles[id] = {
            id: typeof f.id === 'string' ? f.id : id,
            mimeType: f.mimeType || 'image/png',
            created: typeof f.created === 'number' ? f.created : Date.now(),
            dataURL: f.dataURL,
          }
          if (!relByFileIdRef.current.has(id) && !pendingImportRef.current.has(id)) {
            enqueueImport(id, nextFiles[id])
          }
        }
      }
      filesRef.current = nextFiles

      // C. Throttled disk dirty only.
      scheduleDraftAuto()
    },
    [enqueueImport, scheduleDraftAuto],
  )

  const flushToStore = useCallback(
    (opts?: FlushToStoreOpts) => {
      const mode: BoardFlushMode = opts?.mode ?? 'snapshot'
      const id = boardIdRef.current

      // 1. Cancel throttled setDraftBody (avoid late timer after leave).
      if (throttleTimerRef.current != null) {
        clearTimeout(throttleTimerRef.current)
        throttleTimerRef.current = null
      }

      // 2. leave → drop pending imports + toast once.
      if (mode === 'leave') {
        const pending = pendingImportRef.current
        if (pending.size > 0) {
          const dropIds = new Set(pending)
          for (const fid of dropIds) {
            delete filesRef.current[fid]
          }
          elementsRef.current = stripImageElementsForFiles(elementsRef.current, dropIds)
          pendingImportRef.current = new Set()
          toast.warning(t('knowledge.board.pendingImageDropped'))
          // Do not await in-flight IPC; results ignored if board no longer active.
        }
      }
      // snapshot: keep pending set / filesRef / image elements

      // 3–5. Dehydrated only; completed rels; persist none.
      const disk = buildDiskScene({
        elements: elementsRef.current,
        appState: appStateRef.current,
        relByFileId: relByFileIdRef.current,
        runtimeFiles: filesRef.current,
        boardId: id,
      })
      const raw = stableSerializeBoard(disk)
      assertNoDataUrlInBoardJson(raw)
      useKnowledgeStore.getState().setDraftBody(raw, {
        docId: id,
        persist: 'none',
      })
    },
    [t],
  )

  const exportPngBlob = useCallback(async (): Promise<Blob | null> => {
    try {
      const mod = await loadExcalidrawUtils()
      const elements = elementsRef.current as never
      const appState = appStateRef.current as never
      const files = filesRef.current as never
      const blob = await mod.exportToBlob({
        elements,
        appState,
        files,
        mimeType: 'image/png',
      })
      return blob
    } catch {
      return null
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      flushToStore,
      exportPngBlob,
    }),
    [flushToStore, exportPngBlob],
  )

  const langCode = i18n.language?.startsWith('zh')
    ? i18n.language.startsWith('zh-TW') || i18n.language === 'zh-Hant'
      ? 'zh-TW'
      : 'zh-CN'
    : i18n.language?.startsWith('ja')
      ? 'ja-JP'
      : i18n.language?.startsWith('ko')
        ? 'ko-KR'
        : 'en'

  if (!hydrateReady || !initialData) {
    return (
      <div
        className="flex h-full min-h-0 flex-1 items-center justify-center text-meta text-ink-tertiary"
        data-testid="knowledge-board-loading"
      >
        {t('knowledge.board.loading')}
      </div>
    )
  }

  return (
    <div
      className="relative h-full min-h-0 w-full flex-1 overflow-hidden"
      data-testid="knowledge-board-canvas"
      data-board-id={boardId}
    >
      <Suspense
        fallback={
          <div
            className="flex h-full items-center justify-center text-meta text-ink-tertiary"
            data-testid="knowledge-board-chunk-loading"
          >
            {t('knowledge.board.loading')}
          </div>
        }
      >
        <LazyExcalidraw
          initialData={initialData}
          onChange={onChange}
          theme={theme}
          langCode={langCode}
          UIOptions={{
            canvasActions: {
              // hip owns save; avoid confusing library/load cloud UI in v1
              loadScene: false,
              saveToActiveFile: false,
              export: false,
              saveAsImage: false,
            },
          }}
        />
      </Suspense>
    </div>
  )
})
