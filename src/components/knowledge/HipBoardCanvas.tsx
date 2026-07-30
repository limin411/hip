/**
 * Hip SVG whiteboard (PR-C production engine + PR-5 images / PNG export).
 *
 * Camera is session-only — pan/zoom never call setDraftBody (LKD-14).
 * Draft throttle only when dehydrated scene serializes differently.
 * Undo ring: { elements, filesRel }[] max 50 (LKD-12).
 * Images: draft dehydrated (hipAssetRel); runtime blob URL cache (LKD-7).
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { nanoid } from 'nanoid'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  EMPTY_HIP_BOARD_SCENE,
  EMPTY_HIP_BOARD_SCENE_JSON,
  HIP_BOARD_DEFAULT_CAMERA,
  assertNoDataUrlInBoardJson,
  buildHipDiskScene,
  estimateDataUrlBytes,
  hydrateBoardFiles,
  importBoardFileBytes,
  parseBoardScene,
  serializeHipBoard,
  stripImageElementsForFiles,
  type HipBoardCamera,
  type HipBoardElement,
  type HipBoardImage,
  type HipBoardLine,
  type HipBoardSceneDisk,
  type HipBoardText,
} from '@/domain/knowledge/boardScene'
import {
  blobToDataUrl,
  dataUrlToBlobUrl,
  decodeImageNaturalSize,
  exportBoardPngBlob,
  fitImageSize,
  resolveDataUrlForExport,
} from '@/domain/knowledge/boardExport'
import { isAllowedAssetMime, isImageMime, mimeFromFileName } from '@/domain/knowledge/assetUrl'
import { KNOWLEDGE_ASSET_INLINE_MAX_BYTES } from '@/domain/knowledge/limits'
import {
  registerBoardCanvasStyleApi,
  useKnowledgeStore,
} from '@/store/knowledgeStore'
import {
  BOARD_DEFAULT_CORNER_RADIUS,
  BOARD_DEFAULT_FILL,
  BOARD_DEFAULT_STROKE,
  BOARD_DEFAULT_STROKE_WIDTH,
  BOARD_HISTORY_MAX,
  BOARD_TEXT_DEFAULT_FONT_SIZE,
  BOARD_TEXT_DEFAULT_W,
  BOARD_TEXT_PADDING,
  applyBoxResize,
  arrowHeadPoints,
  boxHandlePositions,
  clampCamera,
  clampZoom,
  cloneHistoryEntry,
  deleteElements,
  elementAabb,
  hitTest,
  hitTestBoxHandle,
  hitTestLineEndpoint,
  hitTestMarquee,
  isBoxResizable,
  isTinyBox,
  isTinyLine,
  measureTextHeight,
  moveElements,
  moveLineEndpoint,
  normalizeRectFromDrag,
  pushHistory,
  resizeBoxFromHandle,
  screenToWorld,
  selectionUnionAabb,
  textLineHeight,
  worldGroupTransform,
  worldToScreen,
  zoomAtScreenPoint,
  type BoardHistoryEntry,
  type BoardTool,
  type BoxHandle,
  type EndpointHandle,
  type WorldAabb,
} from '@/domain/knowledge/boardOps'
import {
  BOARD_OUTLINE_DEBOUNCE_MS,
  boardOutlineSignature,
  buildSelectionSnapshot,
  extractBoardOutline,
  selectionPublishSignature,
} from '@/domain/knowledge/boardOutline'
import { BoardToolbar } from './BoardToolbar'

/** Runtime display cache for board images (never stringified into draft). */
type RuntimeImage = {
  fileId: string
  mimeType: string
  /** Prefer blob: for <image href>. */
  url: string
  revoke?: () => void
  /** Kept for PNG export (data: only). */
  dataURL?: string
  naturalW?: number
  naturalH?: number
  /** Stable disk metadata (mime/created); not blob-lifetime-bound. */
  created?: number
}

/** Long-lived file metadata for dehydrate (survives blob revoke). */
type FilesMeta = { mimeType: string; created: number }

export type BoardFlushMode = 'snapshot' | 'leave'

export type FlushToStoreOpts = {
  /**
   * snapshot (default): stay on this board after the structural op — keep pending imports.
   * leave: active leaf will change or be destroyed — drop pending + toast.
   */
  mode?: BoardFlushMode
}

export type StylePatch = Partial<{
  fill: string
  stroke: string
  strokeWidth: number
  fontSize: 12 | 16 | 24
  cornerRadius: number
}>

/** Imperative handle for HipBoardCanvas (production whiteboard engine). */
export type HipBoardCanvasHandle = {
  /**
   * 100% synchronous. mode 'leave' drops pending imports + toast;
   * mode 'snapshot' (default) keeps queue. Always setDraftBody dehydrated persist none.
   */
  flushToStore: (opts?: FlushToStoreOpts) => void
  exportPngBlob: () => Promise<Blob | null>
  isReady: () => boolean
  selectAndScrollTo: (ids: string[], opts?: { scroll?: boolean }) => void
  applyStylePatch: (ids: string[], patch: StylePatch) => void
  updateText: (id: string, text: string) => void
  /**
   * Re-enable input after leave-mode freeze when openDoc/flush aborts
   * (unsupported confirm cancel / write error). Unmount still freezes for real leave.
   */
  resumeEditing: () => void
  /** Test / debug: current session camera (not on disk). */
  getCamera: () => HipBoardCamera
  /** Test / debug: current tool. */
  getTool: () => BoardTool
  /** Test / debug: selected element ids. */
  getSelectedIds: () => string[]
  /** Test / debug: current elements snapshot. */
  getElements: () => HipBoardElement[]
  /** Test / debug: filesRel map (fileId → hipAssetRel). */
  getFilesRel: () => Record<string, string>
  /** Test / debug: pending import fileIds. */
  getPendingImportIds: () => string[]
  /** Test / debug: runtime image URL for a fileId (blob: or data:). */
  getRuntimeImageUrl: (fileId: string) => string | undefined
  /** Test / debug: undo past depth. */
  getHistoryPastLength: () => number
  undo: () => void
  redo: () => void
  /** Test / production: insert image files (same as paste/drop/picker). */
  insertImageFiles: (files: File[]) => Promise<void>
}

export type HipBoardCanvasProps = {
  boardId: string
  spaceId: string
  /** Dehydrated hip-board (or dual-parse) JSON. Mount once; uncontrolled after. */
  initialJson: string
  /**
   * Optional draft writer. Called on scene changes (throttled) and flushToStore.
   * Never called for camera-only or selection-only ops (LKD-14).
   */
  onDraftBody?: (raw: string, opts: { docId: string; persist: 'auto' | 'none' }) => void
}

const WHEEL_ZOOM_SENSITIVITY = 0.0015
const THROTTLE_MS = 150
const TEXT_FONT_FAMILY = 'ui-sans-serif, system-ui, sans-serif'

type Gesture =
  | {
      kind: 'pan'
      pointerId: number
      startSX: number
      startSY: number
      originX: number
      originY: number
    }
  | {
      kind: 'create'
      pointerId: number
      tool: 'rect' | 'ellipse' | 'line' | 'arrow'
      elementId: string
      startWX: number
      startWY: number
      /** Snapshot before create (for undo + discard). */
      before: BoardHistoryEntry
    }
  | {
      kind: 'marquee'
      pointerId: number
      startWX: number
      startWY: number
      currentWX: number
      currentWY: number
    }
  | {
      kind: 'move'
      pointerId: number
      startWX: number
      startWY: number
      /** Elements at pointerdown (preview applies delta from these). */
      originElements: HipBoardElement[]
      ids: string[]
      before: BoardHistoryEntry
      moved: boolean
    }
  | {
      kind: 'resize'
      pointerId: number
      elementId: string
      handle: BoxHandle
      originBox: WorldAabb
      before: BoardHistoryEntry
      changed: boolean
    }
  | {
      kind: 'endpoint'
      pointerId: number
      elementId: string
      which: EndpointHandle
      before: BoardHistoryEntry
      changed: boolean
    }

type TextEditState = {
  id: string
  draft: string
  /** True only for text placed via text tool this session; Escape may drop it. */
  isNew?: boolean
}

function newElementId(prefix: string): string {
  return `${prefix}_${nanoid(10)}`
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return Boolean(target.closest('textarea, input, [contenteditable="true"]'))
}

export const HipBoardCanvas = forwardRef<HipBoardCanvasHandle, HipBoardCanvasProps>(
  function HipBoardCanvas({ boardId, spaceId, initialJson, onDraftBody }, ref) {
    const { t } = useTranslation()
    const rootRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const elementsRef = useRef<HipBoardElement[]>([])
    const filesRelRef = useRef<Record<string, string>>({})
    /** Runtime image display cache (blob: URLs); never in draft. */
    const filesRuntimeRef = useRef<Map<string, RuntimeImage>>(new Map())
    /**
     * Stable mime/created for dehydrate — independent of blob lifetime so leave
     * serialize does not rewrite metadata (LKD-7 leave order / review Issue 1).
     */
    const filesMetaRef = useRef<Record<string, FilesMeta>>({})
    /** fileIds with in-flight asset import (no hipAssetRel yet). */
    const pendingImportRef = useRef<Set<string>>(new Set())
    const importSerialRef = useRef<Promise<void>>(Promise.resolve())
    const viewBgRef = useRef('#ffffff')
    const cameraRef = useRef<HipBoardCamera>({ ...HIP_BOARD_DEFAULT_CAMERA })
    const activeRef = useRef(true)
    const boardIdRef = useRef(boardId)
    boardIdRef.current = boardId
    const spaceIdRef = useRef(spaceId)
    spaceIdRef.current = spaceId
    const lastSerializedRef = useRef<string>('')
    const readyRef = useRef(false)
    const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    /** Companion selection publish rAF (LKD-22/23/26). */
    const selRafRef = useRef<number | null>(null)
    /** Companion structure debounce timer (LKD-22/26). */
    const outlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastSelPublishSigRef = useRef('')
    const lastOutSigRef = useRef('')
    const gestureRef = useRef<Gesture | null>(null)
    const spaceDownRef = useRef(false)
    const toolRef = useRef<BoardTool>('select')
    const selectedIdsRef = useRef<string[]>([])
    const textEditOriginalRef = useRef<string>('')
    const textEditRef = useRef<TextEditState | null>(null)
    /** Undo past (older → newer). Cleared on leave. */
    const historyPastRef = useRef<BoardHistoryEntry[]>([])
    /** Redo future. Cleared on leave and on new commits. */
    const historyFutureRef = useRef<BoardHistoryEntry[]>([])
    /** Text edit: snapshot before edit for undo on commit. */
    const textEditBeforeRef = useRef<BoardHistoryEntry | null>(null)

    const [camera, setCamera] = useState<HipBoardCamera>(() => ({
      ...HIP_BOARD_DEFAULT_CAMERA,
    }))
    const [viewBg, setViewBg] = useState('#ffffff')
    const [elements, setElements] = useState<HipBoardElement[]>([])
    const [tool, setTool] = useState<BoardTool>('select')
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [textEdit, setTextEdit] = useState<TextEditState | null>(null)
    // Bump when camera moves during text edit so overlay screen-box recalculates.
    const [overlayTick, setOverlayTick] = useState(0)
    /** Live marquee AABB in world space (null when idle). */
    const [marquee, setMarquee] = useState<WorldAabb | null>(null)
    /** Bump when runtime image URLs change so SVG <image> re-renders. */
    const [imageTick, setImageTick] = useState(0)

    toolRef.current = tool
    selectedIdsRef.current = selectedIds
    textEditRef.current = textEdit

    const revokeAllRuntimeImages = useCallback(() => {
      for (const rt of filesRuntimeRef.current.values()) {
        try {
          rt.revoke?.()
        } catch {
          /* ignore */
        }
      }
      filesRuntimeRef.current = new Map()
    }, [])

    const putRuntimeImage = useCallback((rt: RuntimeImage) => {
      const prev = filesRuntimeRef.current.get(rt.fileId)
      if (prev && prev.url !== rt.url) {
        try {
          prev.revoke?.()
        } catch {
          /* ignore */
        }
      }
      filesRuntimeRef.current.set(rt.fileId, rt)
      setImageTick((n) => n + 1)
    }, [])

    const dropRuntimeImages = useCallback((fileIds: ReadonlySet<string>) => {
      let changed = false
      for (const id of fileIds) {
        const rt = filesRuntimeRef.current.get(id)
        if (rt) {
          try {
            rt.revoke?.()
          } catch {
            /* ignore */
          }
          filesRuntimeRef.current.delete(id)
          changed = true
        }
        delete filesMetaRef.current[id]
      }
      if (changed) setImageTick((n) => n + 1)
    }, [])

    const setFileMeta = useCallback((fileId: string, meta: FilesMeta) => {
      filesMetaRef.current = { ...filesMetaRef.current, [fileId]: meta }
    }, [])

    const clearThrottle = useCallback(() => {
      if (throttleTimerRef.current != null) {
        clearTimeout(throttleTimerRef.current)
        throttleTimerRef.current = null
      }
    }, [])

    /** Cancel companion rAF/timer and reset publish signatures (LKD-26). */
    const cancelCompanionPublish = useCallback(() => {
      if (selRafRef.current != null) {
        cancelAnimationFrame(selRafRef.current)
        selRafRef.current = null
      }
      if (outlineTimerRef.current != null) {
        clearTimeout(outlineTimerRef.current)
        outlineTimerRef.current = null
      }
      lastSelPublishSigRef.current = ''
      lastOutSigRef.current = ''
    }, [])

    /** Selection → store on rAF when ids+style sig changed (LKD-22/23). */
    const scheduleSelectionPublish = useCallback(() => {
      if (!activeRef.current) return
      if (selRafRef.current != null) return
      selRafRef.current = requestAnimationFrame(() => {
        selRafRef.current = null
        if (!activeRef.current) return
        const id = boardIdRef.current
        if (useKnowledgeStore.getState().activeDocId !== id) return
        const snap = buildSelectionSnapshot(
          id,
          elementsRef.current,
          selectedIdsRef.current,
        )
        const sig = selectionPublishSignature(snap.ids, snap.style)
        if (sig === lastSelPublishSigRef.current) return
        lastSelPublishSigRef.current = sig
        useKnowledgeStore.getState().setBoardSelection(snap)
      })
    }, [])

    /** Structure → store debounced 150ms from elements refs (LKD-21/22). */
    const scheduleOutlinePublish = useCallback(() => {
      if (!activeRef.current) return
      const nextSig = boardOutlineSignature(elementsRef.current)
      if (nextSig === lastOutSigRef.current && outlineTimerRef.current == null) {
        return
      }
      if (outlineTimerRef.current != null) {
        clearTimeout(outlineTimerRef.current)
      }
      outlineTimerRef.current = setTimeout(() => {
        outlineTimerRef.current = null
        if (!activeRef.current) return
        const id = boardIdRef.current
        if (useKnowledgeStore.getState().activeDocId !== id) return
        const els = elementsRef.current
        const sig = boardOutlineSignature(els)
        lastOutSigRef.current = sig
        useKnowledgeStore.getState().setBoardOutline(extractBoardOutline(id, els))
        // Refresh selection style/labels when selection non-empty (text/fill edit).
        if (selectedIdsRef.current.length > 0) {
          const snap = buildSelectionSnapshot(id, els, selectedIdsRef.current)
          const selSig = selectionPublishSignature(snap.ids, snap.style)
          if (selSig !== lastSelPublishSigRef.current) {
            lastSelPublishSigRef.current = selSig
            useKnowledgeStore.getState().setBoardSelection(snap)
          }
        }
      }, BOARD_OUTLINE_DEBOUNCE_MS)
    }, [])

    const snapshotHistory = useCallback((): BoardHistoryEntry => {
      return cloneHistoryEntry(elementsRef.current, filesRelRef.current)
    }, [])

    const commitHistory = useCallback(
      (before: BoardHistoryEntry) => {
        pushHistory(historyPastRef.current, historyFutureRef.current, before)
      },
      [],
    )

    const clearHistory = useCallback(() => {
      historyPastRef.current = []
      historyFutureRef.current = []
    }, [])

    useLayoutEffect(() => {
      activeRef.current = true
      readyRef.current = false
      clearThrottle()
      cancelCompanionPublish()
      gestureRef.current = null
      spaceDownRef.current = false
      textEditOriginalRef.current = ''
      textEditRef.current = null
      textEditBeforeRef.current = null
      historyPastRef.current = []
      historyFutureRef.current = []
      pendingImportRef.current = new Set()
      revokeAllRuntimeImages()
      filesMetaRef.current = {}
      setMarquee(null)

      let scene: HipBoardSceneDisk = EMPTY_HIP_BOARD_SCENE
      try {
        const parsed = parseBoardScene(initialJson || EMPTY_HIP_BOARD_SCENE_JSON)
        if (parsed.type === 'hip-board') {
          // Stamp boardId so leave buildDiskJson matches store draft (no false dirty).
          scene = {
            ...parsed,
            hip: { schemaVersion: 1, boardId: parsed.hip?.boardId ?? boardId },
          }
        } else {
          // openDoc migrates excalidraw → hip before mount; if we still see
          // excalidraw JSON, fall back to empty hip (do not feed legacy shapes).
          scene = {
            ...EMPTY_HIP_BOARD_SCENE,
            hip: { schemaVersion: 1, boardId },
          }
        }
      } catch {
        scene = {
          ...EMPTY_HIP_BOARD_SCENE,
          hip: { schemaVersion: 1, boardId },
        }
      }

      // SYNC seed — must complete before hydrate await / any flushToStore.
      elementsRef.current = scene.elements
      viewBgRef.current = scene.appState.viewBackgroundColor || '#ffffff'
      const rel: Record<string, string> = {}
      const meta: Record<string, FilesMeta> = {}
      for (const [id, f] of Object.entries(scene.files ?? {})) {
        if (f?.hipAssetRel) rel[id] = f.hipAssetRel
        if (f) {
          meta[id] = {
            mimeType:
              typeof f.mimeType === 'string' && f.mimeType.length > 0
                ? f.mimeType
                : 'image/png',
            created:
              typeof f.created === 'number' && Number.isFinite(f.created)
                ? f.created
                : Date.now(),
          }
        }
      }
      filesRelRef.current = rel
      filesMetaRef.current = meta
      lastSerializedRef.current = serializeHipBoard(scene)
      cameraRef.current = { ...HIP_BOARD_DEFAULT_CAMERA }

      setElements(scene.elements)
      setViewBg(viewBgRef.current)
      setCamera({ ...HIP_BOARD_DEFAULT_CAMERA })
      setTool('select')
      toolRef.current = 'select'
      setSelectedIds([])
      selectedIdsRef.current = []
      setTextEdit(null)
      readyRef.current = true

// Immediate companion seed so rail is not empty-flash (LKD-21).
      if (useKnowledgeStore.getState().activeDocId === boardId) {
        const emptySel = buildSelectionSnapshot(boardId, scene.elements, [])
        lastSelPublishSigRef.current = selectionPublishSignature(
          emptySel.ids,
          emptySel.style,
        )
        lastOutSigRef.current = boardOutlineSignature(scene.elements)
        useKnowledgeStore.getState().setBoardOutline(
          extractBoardOutline(boardId, scene.elements),
        )
        useKnowledgeStore.getState().setBoardSelection(emptySel)
      }

      let cancelled = false
      const diskFiles = scene.files
      const space = spaceId
      void (async () => {
        if (Object.keys(diskFiles).length === 0) return
        const { files, relByFileId, failedIds } = await hydrateBoardFiles(space, diskFiles)
        if (cancelled || !activeRef.current) return
        if (failedIds.length > 0) {
          toast.warning(t('knowledge.board.hydratePartial'))
        }
        for (const [id, relPath] of relByFileId) {
          filesRelRef.current[id] = relPath
        }
        for (const [id, file] of Object.entries(files)) {
          if (!file?.dataURL) continue
          const mimeType = file.mimeType || 'image/png'
          const created =
            typeof file.created === 'number' && Number.isFinite(file.created)
              ? file.created
              : filesMetaRef.current[id]?.created ?? Date.now()
          setFileMeta(id, { mimeType, created })
          try {
            const blobbed = dataUrlToBlobUrl(file.dataURL)
            putRuntimeImage({
              fileId: id,
              mimeType: mimeType || blobbed.mimeType,
              url: blobbed.url,
              revoke: blobbed.revoke,
              dataURL: file.dataURL,
              created,
            })
          } catch {
            // Fall back to data: URL for display.
            putRuntimeImage({
              fileId: id,
              mimeType,
              url: file.dataURL,
              dataURL: file.dataURL,
              created,
            })
          }
        }
      })()

      return () => {
        cancelled = true
        activeRef.current = false
        readyRef.current = false
        clearThrottle()
        cancelCompanionPublish()
        gestureRef.current = null
        historyPastRef.current = []
        historyFutureRef.current = []
        pendingImportRef.current = new Set()
        // Real leave / remount: free all blob memory (completed kept across leave-freeze).
        revokeAllRuntimeImages()
        filesMetaRef.current = {}
      }
      // Mount once per boardId (parent keys remount).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boardId])

    const buildDiskJson = useCallback((): string => {
      // Prefer long-lived filesMeta (mime/created) so serialize does not depend on
      // blob cache lifetime; fall back to runtime for any missing meta.
      const runtimeFiles: Record<string, { mimeType?: string; created?: number }> = {
        ...filesMetaRef.current,
      }
      for (const [id, rt] of filesRuntimeRef.current) {
        if (!runtimeFiles[id]) {
          runtimeFiles[id] = {
            mimeType: rt.mimeType,
            created: rt.created,
          }
        }
      }
      const scene = buildHipDiskScene({
        elements: elementsRef.current,
        appState: { viewBackgroundColor: viewBgRef.current },
        relByFileId: filesRelRef.current,
        runtimeFiles,
        boardId: boardIdRef.current,
      })
      const raw = serializeHipBoard(scene)
      assertNoDataUrlInBoardJson(raw)
      return raw
    }, [])

    /** Write draft via prop override or knowledgeStore (production path). */
    const writeDraft = useCallback(
      (raw: string, persist: 'auto' | 'none') => {
        const docId = boardIdRef.current
        if (onDraftBody) {
          onDraftBody(raw, { docId, persist })
          return
        }
        useKnowledgeStore.getState().setDraftBody(raw, { docId, persist })
      },
      [onDraftBody],
    )

    /** Schedule setDraftBody only when dehydrated serialize changes (LKD-14). */
    const scheduleDraftAuto = useCallback(() => {
      if (!activeRef.current) return
      if (throttleTimerRef.current != null) return
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null
        if (!activeRef.current) return
        const raw = buildDiskJson()
        if (raw === lastSerializedRef.current) return
        lastSerializedRef.current = raw
        writeDraft(raw, 'auto')
      }, THROTTLE_MS)
    }, [buildDiskJson, writeDraft])

    const setElementsBoth = useCallback(
      (next: HipBoardElement[], opts?: { draft?: boolean }) => {
        elementsRef.current = next
        setElements(next)
        if (opts?.draft !== false) scheduleDraftAuto()
        scheduleOutlinePublish()
        scheduleSelectionPublish()
      },
      [scheduleDraftAuto, scheduleOutlinePublish, scheduleSelectionPublish],
    )

    const setSelection = useCallback(
      (ids: string[]) => {
        selectedIdsRef.current = ids
        setSelectedIds(ids)
        // Selection-only — never schedule draft (LKD-14 / LKD-16)
        scheduleSelectionPublish()
      },
      [scheduleSelectionPublish],
    )

    /** Apply a history entry (undo/redo). Does not re-push history. */
    const applyHistoryEntry = useCallback(
      (entry: BoardHistoryEntry) => {
        const els = entry.elements.map((e) => ({ ...e })) as HipBoardElement[]
        const rel = { ...entry.filesRel }
        elementsRef.current = els
        filesRelRef.current = rel
        setElements(els)
        const alive = new Set(els.map((e) => e.id))
        setSelection(selectedIdsRef.current.filter((id) => alive.has(id)))
        // Drop pending that no longer match any image element (undo while importing).
        const liveFileIds = new Set(
          els.filter((e): e is HipBoardImage => e.type === 'image').map((e) => e.fileId),
        )
        for (const fid of [...pendingImportRef.current]) {
          if (!liveFileIds.has(fid)) pendingImportRef.current.delete(fid)
        }
        // Runtime cache: keep entries still referenced; orphan blobs stay until leave
        // (undo may resurrect image elements that still have a cached URL).
        scheduleDraftAuto()
        scheduleOutlinePublish()
      },
      [scheduleDraftAuto, scheduleOutlinePublish, setSelection],
    )

    const undo = useCallback(() => {
      if (!activeRef.current) return
      if (textEditRef.current) return
      const past = historyPastRef.current
      if (past.length === 0) return
      const current = snapshotHistory()
      const prev = past.pop()!
      historyFutureRef.current.push(current)
      applyHistoryEntry(prev)
    }, [applyHistoryEntry, snapshotHistory])

    const redo = useCallback(() => {
      if (!activeRef.current) return
      if (textEditRef.current) return
      const future = historyFutureRef.current
      if (future.length === 0) return
      const current = snapshotHistory()
      const next = future.pop()!
      historyPastRef.current.push(current)
      while (historyPastRef.current.length > BOARD_HISTORY_MAX) {
        historyPastRef.current.shift()
      }
      applyHistoryEntry(next)
    }, [applyHistoryEntry, snapshotHistory])

    const changeTool = useCallback((next: BoardTool) => {
      if (!activeRef.current) return
      if (textEditRef.current) return
      toolRef.current = next
      setTool(next)
    }, [])

    /**
     * Fold open textarea draft into elementsRef (and React state).
     * close=true clears the editor UI (leave / explicit commit).
     * close=false soft-commits for snapshot flush while keeping the editor open.
     */
    const foldOpenTextDraft = useCallback(
      (opts: { close: boolean }) => {
        const edit = textEditRef.current
        if (!edit) return
        const el = elementsRef.current.find((e) => e.id === edit.id)
        if (el && el.type === 'text') {
          const h = measureTextHeight(edit.draft, el.fontSize)
          if (el.text !== edit.draft || el.h !== h) {
            const next = elementsRef.current.map((e) =>
              e.id === edit.id && e.type === 'text'
                ? { ...e, text: edit.draft, h }
                : e,
            )
            elementsRef.current = next
            setElements(next)
          }
          // Soft-commit becomes the new baseline for cancel.
          textEditOriginalRef.current = edit.draft
          // After flush soft-commit, cancel must not delete the placement.
          if (!opts.close && edit.isNew) {
            const st: TextEditState = { ...edit, isNew: false }
            textEditRef.current = st
            setTextEdit(st)
          }
        }
        if (opts.close) {
          textEditRef.current = null
          setTextEdit(null)
          textEditOriginalRef.current = ''
        }
      },
      [],
    )

    const commitTextEdit = useCallback(
      (opts?: { cancel?: boolean }) => {
        const edit = textEditRef.current
        if (!edit) return
        const el = elementsRef.current.find((e) => e.id === edit.id)
        const before = textEditBeforeRef.current
        textEditBeforeRef.current = null
        if (!el || el.type !== 'text') {
          textEditRef.current = null
          setTextEdit(null)
          textEditOriginalRef.current = ''
          return
        }
        if (opts?.cancel) {
          // Drop only brand-new placements from text tool this session (isNew).
          // before snapshot already excludes the new placement (captured at place).
          if (edit.isNew) {
            // Restore pre-place scene without an extra history push (cancel).
            if (before) {
              elementsRef.current = before.elements.map((e) => ({
                ...e,
              })) as HipBoardElement[]
              filesRelRef.current = { ...before.filesRel }
              setElements(elementsRef.current)
              scheduleDraftAuto()
            } else {
              setElementsBoth(
                elementsRef.current.filter((e) => e.id !== edit.id),
              )
            }
            setSelection([])
          } else {
            const original = textEditOriginalRef.current
            if (
              el.text !== original ||
              el.h !== measureTextHeight(original, el.fontSize)
            ) {
              const restored: HipBoardText = {
                ...el,
                text: original,
                h: measureTextHeight(original, el.fontSize),
              }
              setElementsBoth(
                elementsRef.current.map((e) => (e.id === edit.id ? restored : e)),
              )
            }
            // Cancel existing edit: no history push (scene back to original).
          }
        } else {
          const nextText = edit.draft
          const h = measureTextHeight(nextText, el.fontSize)
          const changed = el.text !== nextText || el.h !== h
          // For brand-new text, placement already mutated elements; push pre-place.
          // For existing text, push only if content changed vs original baseline.
          if (edit.isNew) {
            if (before) commitHistory(before)
            if (changed) {
              const updated: HipBoardText = { ...el, text: nextText, h }
              setElementsBoth(
                elementsRef.current.map((e) => (e.id === edit.id ? updated : e)),
              )
            } else {
              // Empty new text still committed as a placement.
              scheduleDraftAuto()
            }
          } else if (changed) {
            if (before) commitHistory(before)
            const updated: HipBoardText = { ...el, text: nextText, h }
            setElementsBoth(
              elementsRef.current.map((e) => (e.id === edit.id ? updated : e)),
            )
          }
        }
        textEditRef.current = null
        setTextEdit(null)
        textEditOriginalRef.current = ''
        // Return focus to canvas for shortcuts.
        requestAnimationFrame(() => rootRef.current?.focus())
      },
      [commitHistory, scheduleDraftAuto, setElementsBoth, setSelection],
    )

    const beginTextEdit = useCallback(
      (id: string, editOpts?: { isNew?: boolean }) => {
        if (!activeRef.current) return
        const el = elementsRef.current.find((e) => e.id === id)
        if (!el || el.type !== 'text') return
        if (el.locked) return
        // Commit any prior edit first.
        if (textEditRef.current && textEditRef.current.id !== id) {
          commitTextEdit()
        }
        // Capture undo baseline. For isNew, caller already set textEditBeforeRef.
        if (!editOpts?.isNew) {
          textEditBeforeRef.current = snapshotHistory()
        }
        textEditOriginalRef.current = el.text
        const state: TextEditState = {
          id,
          draft: el.text,
          ...(editOpts?.isNew ? { isNew: true } : {}),
        }
        textEditRef.current = state
        setTextEdit(state)
        setSelection([id])
        requestAnimationFrame(() => {
          const ta = textareaRef.current
          if (!ta) return
          ta.focus()
          ta.select()
        })
      },
      [commitTextEdit, setSelection, snapshotHistory],
    )

    const flushToStore = useCallback(
      (opts?: FlushToStoreOpts) => {
        const isLeave = opts?.mode === 'leave'
        // KD-13: freeze first on leave so concurrent input cannot re-dirty.
        if (isLeave) {
          activeRef.current = false
          gestureRef.current = null
          clearThrottle()
          cancelCompanionPublish()
          clearHistory()
          setMarquee(null)
          // Commit in-progress text into elements before serializing (no cancel).
          foldOpenTextDraft({ close: true })
          // Drop pending image imports + strip elements + toast (LKD-7 leave).
          // Only revoke *pending* blobs here (option A): completed stay for
          // resumeEditing after flush abort; full revoke on unmount/boardId cleanup.
          const pending = pendingImportRef.current
          if (pending.size > 0) {
            const dropIds = new Set(pending)
            elementsRef.current = stripImageElementsForFiles(
              elementsRef.current,
              dropIds,
            ) as HipBoardElement[]
            setElements(elementsRef.current)
            for (const fid of dropIds) {
              delete filesRelRef.current[fid]
            }
            // dropRuntimeImages also clears filesMeta for those ids + revokes blobs.
            dropRuntimeImages(dropIds)
            pendingImportRef.current = new Set()
            toast.warning(t('knowledge.board.pendingImageDropped'))
          }
          // LKD-7 leave order: build disk scene / setDraftBody *while* completed
          // runtime meta still present, then do not revoke completed (unmount does).
          const raw = buildDiskJson()
          lastSerializedRef.current = raw
          writeDraft(raw, 'none')
          return
        }
        if (!activeRef.current) {
          return
        }
        // Snapshot / syncActiveEditorToDraft: include live textarea in draftBody
        // without closing the editor. Keep pending imports (mode snapshot).
        foldOpenTextDraft({ close: false })
        const raw = buildDiskJson()
        lastSerializedRef.current = raw
        writeDraft(raw, 'none')
      },
      [
        buildDiskJson,
cancelCompanionPublish,
        clearHistory,
        clearThrottle,
        dropRuntimeImages,
        foldOpenTextDraft,
        t,
        writeDraft,
      ],
    )

    const fitSelectionInView = useCallback(
      (ids: string[]) => {
        const aabb = selectionUnionAabb(elementsRef.current, ids)
        if (!aabb) return
        const root = rootRef.current
        if (!root) return
        const rect = root.getBoundingClientRect()
        const pad = 48
        const vw = Math.max(1, rect.width - pad * 2)
        const vh = Math.max(1, rect.height - pad * 2)
        const zw = aabb.w > 0 ? vw / aabb.w : 1
        const zh = aabb.h > 0 ? vh / aabb.h : 1
        const zoom = clampZoom(Math.min(zw, zh, 2))
        const cx = aabb.x + aabb.w / 2
        const cy = aabb.y + aabb.h / 2
        const next = clampCamera({
          x: rect.width / 2 - cx * zoom,
          y: rect.height / 2 - cy * zoom,
          zoom,
        })
        cameraRef.current = next
        setCamera(next)
        if (textEditRef.current) setOverlayTick((n) => n + 1)
      },
      [],
    )

    const applyStylePatch = useCallback(
      (ids: string[], patch: StylePatch) => {
        if (!activeRef.current) return
        // LKD-10 / handle contract: refuse cross-board stale registry ticks.
        // Skip only when store has a different active leaf (null = unit-test / no leaf).
        const activeId = useKnowledgeStore.getState().activeDocId
        if (activeId != null && activeId !== boardIdRef.current) return
        if (ids.length === 0) return
        const idSet = new Set(ids)
        let changed = false
        const next = elementsRef.current.map((el) => {
          if (!idSet.has(el.id) || el.locked) return el
          if (el.type === 'rect') {
            const u = {
              ...el,
              ...(patch.fill !== undefined ? { fill: patch.fill } : {}),
              ...(patch.stroke !== undefined ? { stroke: patch.stroke } : {}),
              ...(patch.strokeWidth !== undefined
                ? { strokeWidth: patch.strokeWidth }
                : {}),
              ...(patch.cornerRadius !== undefined
                ? { cornerRadius: patch.cornerRadius }
                : {}),
            }
            if (
              u.fill !== el.fill ||
              u.stroke !== el.stroke ||
              u.strokeWidth !== el.strokeWidth ||
              u.cornerRadius !== el.cornerRadius
            ) {
              changed = true
              return u
            }
          } else if (el.type === 'ellipse') {
            const u = {
              ...el,
              ...(patch.fill !== undefined ? { fill: patch.fill } : {}),
              ...(patch.stroke !== undefined ? { stroke: patch.stroke } : {}),
              ...(patch.strokeWidth !== undefined
                ? { strokeWidth: patch.strokeWidth }
                : {}),
            }
            if (
              u.fill !== el.fill ||
              u.stroke !== el.stroke ||
              u.strokeWidth !== el.strokeWidth
            ) {
              changed = true
              return u
            }
          } else if (el.type === 'line' || el.type === 'arrow') {
            const u = {
              ...el,
              ...(patch.stroke !== undefined ? { stroke: patch.stroke } : {}),
              ...(patch.strokeWidth !== undefined
                ? { strokeWidth: patch.strokeWidth }
                : {}),
            }
            if (u.stroke !== el.stroke || u.strokeWidth !== el.strokeWidth) {
              changed = true
              return u
            }
          } else if (el.type === 'text') {
            const fontSize = patch.fontSize ?? el.fontSize
            const fill = patch.fill ?? el.fill
            if (fill !== el.fill || fontSize !== el.fontSize) {
              changed = true
              return {
                ...el,
                fill,
                fontSize,
                h: measureTextHeight(el.text, fontSize),
              }
            }
          }
          return el
        })
        if (changed) {
          commitHistory(snapshotHistory())
          setElementsBoth(next)
        }
      },
      [commitHistory, setElementsBoth, snapshotHistory],
    )

    const updateText = useCallback(
      (id: string, text: string) => {
        if (!activeRef.current) return
        const activeId = useKnowledgeStore.getState().activeDocId
        if (activeId != null && activeId !== boardIdRef.current) return
        const el = elementsRef.current.find((e) => e.id === id)
        if (!el || el.type !== 'text' || el.locked) return
        const h = measureTextHeight(text, el.fontSize)
        if (el.text === text && el.h === h) return
        // If mid-edit via textarea, skip separate history (commitTextEdit owns it).
        if (!textEditRef.current || textEditRef.current.id !== id) {
          commitHistory(snapshotHistory())
        }
        setElementsBoth(
          elementsRef.current.map((e) =>
            e.id === id && e.type === 'text' ? { ...e, text, h } : e,
          ),
        )
        if (textEditRef.current?.id === id) {
          const st: TextEditState = {
            id,
            draft: text,
            ...(textEditRef.current.isNew ? { isNew: true } : {}),
          }
          textEditRef.current = st
          setTextEdit(st)
        }
      },
      [commitHistory, setElementsBoth, snapshotHistory],
    )

    const deleteSelection = useCallback(() => {
      if (!activeRef.current) return
      if (textEditRef.current) return
      const ids = selectedIdsRef.current
      if (ids.length === 0) return
      const idSet = new Set(ids)
      // Only push if at least one unlocked selected element will be removed.
      const willDelete = elementsRef.current.some(
        (el) => idSet.has(el.id) && el.locked !== true,
      )
      if (!willDelete) return
      commitHistory(snapshotHistory())
      const next = deleteElements(elementsRef.current, idSet)
      setElementsBoth(next)
      setSelection(ids.filter((id) => next.some((e) => e.id === id)))
    }, [commitHistory, setElementsBoth, setSelection, snapshotHistory])

    /**
     * Consume pendingBoardFocus when ready (LKD-25).
     * Returns true if pending was applied or cleared (mismatch); false if still HOLD.
     */
    const consumePendingFocus = useCallback(() => {
      const pending = useKnowledgeStore.getState().pendingBoardFocus
      if (!pending?.ids.length) return true
      if (!activeRef.current || !readyRef.current) return false // HOLD
      const id = boardIdRef.current
      if (pending.boardId !== id || useKnowledgeStore.getState().activeDocId !== id) {
        useKnowledgeStore.getState().clearPendingBoardFocus()
        return true
      }
      if (textEditRef.current) commitTextEdit()
      setSelection(pending.ids)
      if (pending.scroll) fitSelectionInView(pending.ids)
      useKnowledgeStore.getState().clearPendingBoardFocus()
      return true
    }, [commitTextEdit, fitSelectionInView, setSelection])

    const resumeEditing = useCallback(() => {
      // After leave-mode freeze when flush/open aborts; unmount still freezes for real leave.
      // Completed image blobs are kept across leave (only pending revoked), so display
      // continues without re-hydrate when abort stays on this board.
      activeRef.current = true
      readyRef.current = true
      // LKD-25: re-consume pending held during freeze (effect alone will not re-run).
      consumePendingFocus()
    }, [consumePendingFocus])

    /**
     * Place image elements from File list (paste / drop / picker).
     * Import runs async; leave drops pending + strips elements.
     */
    const insertImageFiles = useCallback(
      async (files: File[]) => {
        if (!activeRef.current) return
        if (textEditRef.current) commitTextEdit()
        const space = spaceIdRef.current
        const board = boardIdRef.current
        const imageFiles = files.filter((f) => {
          const mime =
            (f.type && isImageMime(f.type) ? f.type : null) ??
            (f.type && isAllowedAssetMime(f.type) ? f.type : null) ??
            mimeFromFileName(f.name)
          return Boolean(mime && isImageMime(mime))
        })
        if (imageFiles.length === 0) return

        // Viewport center in world coords for placement.
        const rect = rootRef.current?.getBoundingClientRect()
        const cx = rect ? rect.width / 2 : 200
        const cy = rect ? rect.height / 2 : 150
        const center = screenToWorld(cx, cy, cameraRef.current)

        for (const file of imageFiles) {
          if (!activeRef.current) return
          const mime =
            (file.type && isImageMime(file.type) ? file.type : null) ??
            mimeFromFileName(file.name) ??
            'image/png'
          if (!isImageMime(mime) || !isAllowedAssetMime(mime)) {
            toast.error(t('knowledge.asset.unsupported'))
            continue
          }

          let dataURL: string
          try {
            dataURL = await blobToDataUrl(file)
          } catch {
            toast.error(t('knowledge.asset.importFailed'))
            continue
          }
          if (!activeRef.current) return

          const bytes = estimateDataUrlBytes(dataURL)
          if (bytes > KNOWLEDGE_ASSET_INLINE_MAX_BYTES) {
            toast.error(t('knowledge.asset.tooLargePaste'))
            continue
          }

          const fileId = `img_${nanoid(10)}`
          let blobUrl: string
          let revoke: (() => void) | undefined
          try {
            const blobbed = dataUrlToBlobUrl(dataURL)
            blobUrl = blobbed.url
            revoke = blobbed.revoke
          } catch {
            blobUrl = dataURL
          }

          let naturalW = 200
          let naturalH = 150
          try {
            const sz = await decodeImageNaturalSize(blobUrl)
            naturalW = sz.naturalW
            naturalH = sz.naturalH
          } catch {
            /* keep defaults */
          }
          if (!activeRef.current) {
            revoke?.()
            return
          }

          const { w, h } = fitImageSize(naturalW, naturalH)
          const el: HipBoardImage = {
            id: newElementId('img'),
            type: 'image',
            x: center.x - w / 2,
            y: center.y - h / 2,
            w,
            h,
            fileId,
          }

          const created = Date.now()
          const before = snapshotHistory()
          commitHistory(before)
          pendingImportRef.current.add(fileId)
          setFileMeta(fileId, { mimeType: mime, created })
          putRuntimeImage({
            fileId,
            mimeType: mime,
            url: blobUrl,
            revoke,
            dataURL,
            naturalW,
            naturalH,
            created,
          })
          setElementsBoth([...elementsRef.current, el])
          setSelection([el.id])
          toolRef.current = 'select'
          setTool('select')

          // Serial import queue (one at a time).
          importSerialRef.current = importSerialRef.current
            .then(async () => {
              if (!activeRef.current) return
              if (!pendingImportRef.current.has(fileId)) return
              // Production path: skip if leaf changed (leave already dropped).
              // Tests inject onDraftBody without store activeDoc — allow continue.
              if (
                !onDraftBody &&
                useKnowledgeStore.getState().activeDocId !== board
              ) {
                return
              }
              try {
                const rel = await importBoardFileBytes(space, {
                  id: fileId,
                  mimeType: mime,
                  created,
                  dataURL,
                })
                if (!activeRef.current) return
                if (!pendingImportRef.current.has(fileId)) return
                filesRelRef.current = { ...filesRelRef.current, [fileId]: rel }
                // Keep stable meta (created) from placement; reaffirm mime.
                setFileMeta(fileId, { mimeType: mime, created })
                pendingImportRef.current.delete(fileId)
                scheduleDraftAuto()
              } catch {
                if (!activeRef.current) return
                pendingImportRef.current.delete(fileId)
                dropRuntimeImages(new Set([fileId]))
                elementsRef.current = stripImageElementsForFiles(
                  elementsRef.current,
                  new Set([fileId]),
                ) as HipBoardElement[]
                setElements(elementsRef.current)
                toast.error(t('knowledge.asset.importFailed'))
                scheduleDraftAuto()
              }
            })
            .catch(() => {
              /* serial chain must not break */
            })
        }
      },
      [
        commitHistory,
        commitTextEdit,
        dropRuntimeImages,
        onDraftBody,
        putRuntimeImage,
        scheduleDraftAuto,
        setElementsBoth,
        setFileMeta,
        setSelection,
        snapshotHistory,
        t,
      ],
    )

    const exportPngBlob = useCallback(async (): Promise<Blob | null> => {
      try {
        const imageSrc: Record<string, { dataURL: string }> = {}
        for (const el of elementsRef.current) {
          if (el.type !== 'image') continue
          const rt = filesRuntimeRef.current.get(el.fileId)
          if (!rt) continue
          const dataURL = await resolveDataUrlForExport(rt.url, rt.dataURL)
          if (dataURL) imageSrc[el.fileId] = { dataURL }
        }
        return await exportBoardPngBlob(elementsRef.current, {
          viewBackgroundColor: viewBgRef.current,
          imageSrc,
        })
      } catch {
        return null
      }
    }, [])

    const openImagePicker = useCallback(() => {
      if (!activeRef.current) return
      if (textEditRef.current) commitTextEdit()
      fileInputRef.current?.click()
    }, [commitTextEdit])

    useImperativeHandle(
      ref,
      () => ({
        flushToStore,
        exportPngBlob,
        isReady: () => readyRef.current && activeRef.current,
        resumeEditing,
        selectAndScrollTo: (ids: string[], opts?: { scroll?: boolean }) => {
          if (!activeRef.current) return
          if (textEditRef.current) commitTextEdit()
          setSelection(ids)
          if (opts?.scroll !== false) fitSelectionInView(ids)
        },
        applyStylePatch,
        updateText,
        getCamera: () => ({ ...cameraRef.current }),
        getTool: () => toolRef.current,
        getSelectedIds: () => [...selectedIdsRef.current],
        getElements: () =>
          elementsRef.current.map((e) => ({ ...e })) as HipBoardElement[],
        getFilesRel: () => ({ ...filesRelRef.current }),
        getPendingImportIds: () => [...pendingImportRef.current],
        getRuntimeImageUrl: (fileId: string) =>
          filesRuntimeRef.current.get(fileId)?.url,
        getHistoryPastLength: () => historyPastRef.current.length,
        undo,
        redo,
        insertImageFiles,
      }),
      [
        applyStylePatch,
        commitTextEdit,
exportPngBlob,
        fitSelectionInView,
        flushToStore,
        insertImageFiles,
        redo,
        resumeEditing,
        setSelection,
        undo,
        updateText,
      ],
    )

    // Style editors in right rail (AppLayout) — module registry, not canvas ref
    // (Outline is outside Workspace). Intentional LKD-10 path: no draftBody parse.
    useEffect(() => {
      registerBoardCanvasStyleApi({ applyStylePatch, updateText })
      return () => registerBoardCanvasStyleApi(null)
    }, [applyStylePatch, updateText])

    // pendingBoardFocus → selectAndScrollTo; hold until isReady (LKD-25).
    const pendingBoardFocus = useKnowledgeStore((s) => s.pendingBoardFocus)
    useEffect(() => {
      consumePendingFocus()
    }, [pendingBoardFocus, consumePendingFocus])

    useEffect(() => {
      return () => {
        activeRef.current = false
        clearThrottle()
cancelCompanionPublish()
        revokeAllRuntimeImages()
      }
    }, [cancelCompanionPublish, clearThrottle, revokeAllRuntimeImages])

    // Focus textarea when edit starts.
    useEffect(() => {
      if (!textEdit) return
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
    }, [textEdit?.id])

    const applyCamera = useCallback((next: HipBoardCamera) => {
      if (!activeRef.current) return
      const c = clampCamera(next)
      cameraRef.current = c
      setCamera(c)
      if (textEditRef.current) setOverlayTick((n) => n + 1)
      // LKD-14: camera-only — never setDraftBody / onDraftBody
    }, [])

    const clientToLocal = useCallback((clientX: number, clientY: number) => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return { sx: 0, sy: 0 }
      return { sx: clientX - rect.left, sy: clientY - rect.top }
    }, [])

    const clientToWorld = useCallback(
      (clientX: number, clientY: number) => {
        const { sx, sy } = clientToLocal(clientX, clientY)
        return screenToWorld(sx, sy, cameraRef.current)
      },
      [clientToLocal],
    )

    const onWheel = useCallback(
      (e: React.WheelEvent) => {
        if (!activeRef.current) return
        e.preventDefault()
        const { sx, sy } = clientToLocal(e.clientX, e.clientY)
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)
        const nextZoom = cameraRef.current.zoom * factor
        applyCamera(zoomAtScreenPoint(cameraRef.current, sx, sy, nextZoom))
      },
      [applyCamera, clientToLocal],
    )

    const createShapeAt = useCallback(
      (
        shapeTool: 'rect' | 'ellipse' | 'line' | 'arrow',
        wx: number,
        wy: number,
      ): HipBoardElement => {
        const id = newElementId(shapeTool === 'ellipse' ? 'ell' : shapeTool.slice(0, 3))
        if (shapeTool === 'rect') {
          return {
            id,
            type: 'rect',
            x: wx,
            y: wy,
            w: 0,
            h: 0,
            fill: BOARD_DEFAULT_FILL,
            stroke: BOARD_DEFAULT_STROKE,
            strokeWidth: BOARD_DEFAULT_STROKE_WIDTH,
            cornerRadius: BOARD_DEFAULT_CORNER_RADIUS,
          }
        }
        if (shapeTool === 'ellipse') {
          return {
            id,
            type: 'ellipse',
            x: wx,
            y: wy,
            w: 0,
            h: 0,
            fill: BOARD_DEFAULT_FILL,
            stroke: BOARD_DEFAULT_STROKE,
            strokeWidth: BOARD_DEFAULT_STROKE_WIDTH,
          }
        }
        return {
          id,
          type: shapeTool,
          x: wx,
          y: wy,
          x2: wx,
          y2: wy,
          stroke: BOARD_DEFAULT_STROKE,
          strokeWidth: BOARD_DEFAULT_STROKE_WIDTH,
        }
      },
      [],
    )

    const placeTextAt = useCallback(
      (wx: number, wy: number) => {
        // Pre-place snapshot for undo / Escape cancel.
        textEditBeforeRef.current = snapshotHistory()
        const id = newElementId('txt')
        const fontSize = BOARD_TEXT_DEFAULT_FONT_SIZE
        const el: HipBoardText = {
          id,
          type: 'text',
          x: wx,
          y: wy,
          w: BOARD_TEXT_DEFAULT_W,
          h: measureTextHeight('', fontSize),
          text: '',
          fill: BOARD_DEFAULT_STROKE,
          fontSize,
        }
        // Placement is provisional until text commit; draft on blur/leave.
        setElementsBoth([...elementsRef.current, el], { draft: false })
        setSelection([id])
        // Switch off text tool before edit (changeTool no-ops while editing).
        toolRef.current = 'select'
        setTool('select')
        beginTextEdit(id, { isNew: true })
      },
      [beginTextEdit, setElementsBoth, setSelection, snapshotHistory],
    )

    const onPointerDown = useCallback(
      (e: React.PointerEvent) => {
        if (!activeRef.current) return
        if (textEditRef.current) {
          // Click outside textarea commits edit (textarea has stopPropagation).
          if (e.target instanceof HTMLTextAreaElement) return
          commitTextEdit()
          // Fall through so click can also select / start a new tool action.
        }

        const isMiddle = e.button === 1
        const isPrimary = e.button === 0
        if (!isPrimary && !isMiddle) return

        // Pan: middle button or Space+primary.
        if (isMiddle || (isPrimary && spaceDownRef.current)) {
          e.currentTarget.setPointerCapture(e.pointerId)
          gestureRef.current = {
            kind: 'pan',
            pointerId: e.pointerId,
            startSX: e.clientX,
            startSY: e.clientY,
            originX: cameraRef.current.x,
            originY: cameraRef.current.y,
          }
          return
        }

        if (!isPrimary) return

        const world = clientToWorld(e.clientX, e.clientY)
        const currentTool = toolRef.current
        const zoom = cameraRef.current.zoom

        if (currentTool === 'text') {
          placeTextAt(world.x, world.y)
          return
        }

        if (
          currentTool === 'rect' ||
          currentTool === 'ellipse' ||
          currentTool === 'line' ||
          currentTool === 'arrow'
        ) {
          const before = snapshotHistory()
          const el = createShapeAt(currentTool, world.x, world.y)
          e.currentTarget.setPointerCapture(e.pointerId)
          gestureRef.current = {
            kind: 'create',
            pointerId: e.pointerId,
            tool: currentTool,
            elementId: el.id,
            startWX: world.x,
            startWY: world.y,
            before,
          }
          setElementsBoth([...elementsRef.current, el], { draft: false })
          setSelection([el.id])
          return
        }

        // Select tool: handles → resize/endpoint; shape → move; empty → marquee.
        if (currentTool === 'select') {
          // Resize handle (single selected unlocked box).
          if (selectedIdsRef.current.length === 1) {
            const onlyId = selectedIdsRef.current[0]!
            const only = elementsRef.current.find((x) => x.id === onlyId)
            if (only && !only.locked) {
              if (isBoxResizable(only)) {
                const handle = hitTestBoxHandle(
                  elementAabb(only),
                  world.x,
                  world.y,
                  zoom,
                )
                if (handle) {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  gestureRef.current = {
                    kind: 'resize',
                    pointerId: e.pointerId,
                    elementId: only.id,
                    handle,
                    originBox: elementAabb(only),
                    before: snapshotHistory(),
                    changed: false,
                  }
                  return
                }
              }
              if (only.type === 'line' || only.type === 'arrow') {
                const ep = hitTestLineEndpoint(only, world.x, world.y, zoom)
                if (ep) {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  gestureRef.current = {
                    kind: 'endpoint',
                    pointerId: e.pointerId,
                    elementId: only.id,
                    which: ep,
                    before: snapshotHistory(),
                    changed: false,
                  }
                  return
                }
              }
            }
          }

          const hit = hitTest(elementsRef.current, world.x, world.y, zoom)
          if (hit) {
            const hitEl = elementsRef.current.find((x) => x.id === hit)
            let ids = selectedIdsRef.current
            if (!ids.includes(hit)) {
              ids = [hit]
              setSelection(ids)
            }
            // Locked: select only, no move gesture.
            if (hitEl?.locked) return
            // Move all selected (unlocked ones move; locked stay via moveElements).
            e.currentTarget.setPointerCapture(e.pointerId)
            gestureRef.current = {
              kind: 'move',
              pointerId: e.pointerId,
              startWX: world.x,
              startWY: world.y,
              originElements: elementsRef.current.map((el) => ({
                ...el,
              })) as HipBoardElement[],
              ids: [...ids],
              before: snapshotHistory(),
              moved: false,
            }
            return
          }

          // Empty space → marquee.
          setSelection([])
          e.currentTarget.setPointerCapture(e.pointerId)
          gestureRef.current = {
            kind: 'marquee',
            pointerId: e.pointerId,
            startWX: world.x,
            startWY: world.y,
            currentWX: world.x,
            currentWY: world.y,
          }
          setMarquee({ x: world.x, y: world.y, w: 0, h: 0 })
        }
      },
      [
        clientToWorld,
        commitTextEdit,
        createShapeAt,
        placeTextAt,
        setElementsBoth,
        setSelection,
        snapshotHistory,
      ],
    )

    const onPointerMove = useCallback(
      (e: React.PointerEvent) => {
        if (!activeRef.current) return
        const g = gestureRef.current
        if (!g || g.pointerId !== e.pointerId) return

        if (g.kind === 'pan') {
          const dx = e.clientX - g.startSX
          const dy = e.clientY - g.startSY
          applyCamera({
            ...cameraRef.current,
            x: g.originX + dx,
            y: g.originY + dy,
          })
          return
        }

        if (g.kind === 'create') {
          const world = clientToWorld(e.clientX, e.clientY)
          const next = elementsRef.current.map((el) => {
            if (el.id !== g.elementId) return el
            if (el.type === 'rect' || el.type === 'ellipse') {
              const box = normalizeRectFromDrag(
                g.startWX,
                g.startWY,
                world.x,
                world.y,
              )
              return { ...el, x: box.x, y: box.y, w: box.w, h: box.h }
            }
            if (el.type === 'line' || el.type === 'arrow') {
              return { ...el, x2: world.x, y2: world.y }
            }
            return el
          })
          // Live preview only — draft on pointerup commit.
          elementsRef.current = next
          setElements(next)
          return
        }

        if (g.kind === 'marquee') {
          const world = clientToWorld(e.clientX, e.clientY)
          g.currentWX = world.x
          g.currentWY = world.y
          setMarquee(
            normalizeRectFromDrag(g.startWX, g.startWY, world.x, world.y),
          )
          return
        }

        if (g.kind === 'move') {
          const world = clientToWorld(e.clientX, e.clientY)
          const dx = world.x - g.startWX
          const dy = world.y - g.startWY
          if (dx !== 0 || dy !== 0) g.moved = true
          const next = moveElements(
            g.originElements,
            new Set(g.ids),
            dx,
            dy,
          )
          elementsRef.current = next
          setElements(next)
          return
        }

        if (g.kind === 'resize') {
          const world = clientToWorld(e.clientX, e.clientY)
          const box = resizeBoxFromHandle(
            g.originBox,
            g.handle,
            world.x,
            world.y,
          )
          g.changed = true
          const next = elementsRef.current.map((el) => {
            if (el.id !== g.elementId) return el
            return applyBoxResize(el, box)
          })
          elementsRef.current = next
          setElements(next)
          return
        }

        if (g.kind === 'endpoint') {
          const world = clientToWorld(e.clientX, e.clientY)
          g.changed = true
          const next = elementsRef.current.map((el) => {
            if (el.id !== g.elementId) return el
            if (el.type !== 'line' && el.type !== 'arrow') return el
            return moveLineEndpoint(el as HipBoardLine, g.which, world.x, world.y)
          })
          elementsRef.current = next
          setElements(next)
        }
      },
      [applyCamera, clientToWorld],
    )

    const onPointerUp = useCallback(
      (e: React.PointerEvent) => {
        const g = gestureRef.current
        if (!g || g.pointerId !== e.pointerId) return
        gestureRef.current = null
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          /* already released */
        }

        if (g.kind === 'pan') return

        if (g.kind === 'marquee') {
          const box = normalizeRectFromDrag(
            g.startWX,
            g.startWY,
            g.currentWX,
            g.currentWY,
          )
          setMarquee(null)
          // Click without drag: already cleared selection on down.
          if (box.w < 2 && box.h < 2) return
          const ids = hitTestMarquee(elementsRef.current, box)
          setSelection(ids)
          return
        }

        if (g.kind === 'create') {
          const el = elementsRef.current.find((x) => x.id === g.elementId)
          if (!el) return
          let discard = false
          if (el.type === 'rect' || el.type === 'ellipse') {
            discard = isTinyBox(el.w, el.h)
          } else if (el.type === 'line' || el.type === 'arrow') {
            discard = isTinyLine(el.x, el.y, el.x2, el.y2)
          }
          if (discard) {
            setElementsBoth(
              elementsRef.current.filter((x) => x.id !== g.elementId),
              { draft: false },
            )
            setSelection([])
            return
          }
          commitHistory(g.before)
          scheduleDraftAuto()
          scheduleOutlinePublish()
          // Stay on shape tool for multi-draw (common whiteboard UX).
          return
        }

        if (g.kind === 'move') {
          if (!g.moved) return
          const idSet = new Set(g.ids)
          const anyUnlocked = g.originElements.some(
            (el) => idSet.has(el.id) && el.locked !== true,
          )
          if (!anyUnlocked) return
          commitHistory(g.before)
          scheduleDraftAuto()
          scheduleOutlinePublish()
          return
        }

        if (g.kind === 'resize' || g.kind === 'endpoint') {
          if (!g.changed) return
          commitHistory(g.before)
          scheduleDraftAuto()
          scheduleOutlinePublish()
        }
      },
      [
        commitHistory,
        scheduleDraftAuto,
        scheduleOutlinePublish,
        setElementsBoth,
        setSelection,
      ],
    )

    const onDoubleClick = useCallback(
      (e: React.MouseEvent) => {
        if (!activeRef.current) return
        if (toolRef.current !== 'select' && toolRef.current !== 'text') return
        const world = clientToWorld(e.clientX, e.clientY)
        const hit = hitTest(
          elementsRef.current,
          world.x,
          world.y,
          cameraRef.current.zoom,
        )
        if (!hit) return
        const el = elementsRef.current.find((x) => x.id === hit)
        if (el?.type === 'text') {
          e.preventDefault()
          beginTextEdit(hit)
        }
      },
      [beginTextEdit, clientToWorld],
    )

    const onKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (!activeRef.current) return

        if (e.code === 'Space') {
          // Don't steal space from textarea.
          if (textEditRef.current) return
          if (!spaceDownRef.current) {
            spaceDownRef.current = true
          }
          // Prevent page scroll when canvas focused.
          e.preventDefault()
          return
        }

        if (e.key === 'Escape') {
          e.preventDefault()
          if (textEditRef.current) {
            commitTextEdit({ cancel: true })
            return
          }
          if (toolRef.current !== 'select') {
            changeTool('select')
            return
          }
          setSelection([])
          return
        }

        // While editing text: tool shortcuts disabled (except handled above).
        if (textEditRef.current) return
        if (isEditableTarget(e.target)) return

        // Undo / redo (Cmd/Ctrl+Z, Shift+Z or Y) — LKD-12
        if ((e.metaKey || e.ctrlKey) && !e.altKey) {
          const k = e.key.toLowerCase()
          if (k === 'z' && !e.shiftKey) {
            e.preventDefault()
            undo()
            return
          }
          if ((k === 'z' && e.shiftKey) || k === 'y') {
            e.preventDefault()
            redo()
            return
          }
        }

        // Delete / Backspace removes selected (skips locked) — PR-3
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          deleteSelection()
          return
        }

        // Enter → edit single selected text.
        if (e.key === 'Enter') {
          const ids = selectedIdsRef.current
          if (ids.length === 1) {
            const el = elementsRef.current.find((x) => x.id === ids[0])
            if (el?.type === 'text') {
              e.preventDefault()
              beginTextEdit(el.id)
            }
          }
          return
        }

        if (e.metaKey || e.ctrlKey || e.altKey) return
        const k = e.key.toLowerCase()
        const map: Record<string, BoardTool> = {
          v: 'select',
          r: 'rect',
          o: 'ellipse',
          l: 'line',
          a: 'arrow',
          t: 'text',
        }
        const next = map[k]
        if (next) {
          e.preventDefault()
          changeTool(next)
        }
      },
      [
        beginTextEdit,
        changeTool,
        commitTextEdit,
        deleteSelection,
        redo,
        setSelection,
        undo,
      ],
    )

    const onKeyUp = useCallback((e: React.KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDownRef.current = false
      }
    }, [])

    const onPaste = useCallback(
      (e: React.ClipboardEvent) => {
        if (!activeRef.current) return
        if (textEditRef.current) return
        if (isEditableTarget(e.target)) return
        const items = e.clipboardData?.items
        if (!items || items.length === 0) return
        const files: File[] = []
        for (const item of Array.from(items)) {
          if (item.kind !== 'file') continue
          if (!item.type.startsWith('image/') || item.type === 'image/svg+xml') continue
          const f = item.getAsFile()
          if (f) files.push(f)
        }
        if (files.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        void insertImageFiles(files)
      },
      [insertImageFiles],
    )

    const onDragOver = useCallback((e: React.DragEvent) => {
      if (!activeRef.current) return
      if (!e.dataTransfer?.types?.includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }, [])

    const onDrop = useCallback(
      (e: React.DragEvent) => {
        if (!activeRef.current) return
        if (!e.dataTransfer?.files?.length) return
        const files = Array.from(e.dataTransfer.files).filter((f) => {
          const mime = f.type || mimeFromFileName(f.name) || ''
          return isImageMime(mime)
        })
        if (files.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        void insertImageFiles(files)
      },
      [insertImageFiles],
    )

    const onFileInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const list = e.target.files
        if (!list || list.length === 0) return
        const files = Array.from(list)
        // Reset so the same file can be re-picked.
        e.target.value = ''
        void insertImageFiles(files)
      },
      [insertImageFiles],
    )

    const transform = worldGroupTransform(camera)
    // imageTick forces re-render when runtime blob URLs hydrate.
    void imageTick

    // Textarea overlay screen box (recompute from camera + element).
    let textOverlayStyle: React.CSSProperties | undefined
    if (textEdit) {
      const el = elements.find((x) => x.id === textEdit.id)
      if (el && el.type === 'text') {
        const cam = camera
        const tl = worldToScreen(el.x, el.y, cam)
        const fontSizePx = el.fontSize * cam.zoom
        const hWorld = measureTextHeight(textEdit.draft, el.fontSize)
        const wPx = Math.max(24, el.w * cam.zoom)
        const hPx = Math.max(fontSizePx + BOARD_TEXT_PADDING * 2 * cam.zoom, hWorld * cam.zoom)
        textOverlayStyle = {
          position: 'absolute',
          left: tl.x,
          top: tl.y,
          width: wPx,
          height: hPx,
          fontSize: fontSizePx,
          lineHeight: `${textLineHeight(el.fontSize) * cam.zoom}px`,
          fontFamily: TEXT_FONT_FAMILY,
          color: el.fill,
          padding: BOARD_TEXT_PADDING * cam.zoom,
          whiteSpace: 'pre',
          overflowX: 'auto',
          overflowY: 'hidden',
          resize: 'none',
          border: '1px solid var(--accent, #3b82f6)',
          borderRadius: 2,
          background: 'var(--surface, #fff)',
          outline: 'none',
          boxSizing: 'border-box',
          zIndex: 20,
          margin: 0,
        }
        // overlayTick forces re-render on camera pan while editing
        void overlayTick
      }
    }

    const cursor =
      spaceDownRef.current || tool === 'select'
        ? undefined
        : tool === 'text'
          ? 'text'
          : 'crosshair'

    return (
      <div
        ref={rootRef}
        className="board-root relative h-full w-full min-h-[200px] overflow-hidden outline-none"
        data-testid="knowledge-board-canvas"
        data-engine="hip"
        data-board-id={boardId}
        data-tool={tool}
        tabIndex={0}
        aria-label="Whiteboard"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onPaste={onPaste}
        onDragOver={onDragOver}
        onDrop={onDrop}
        style={{ backgroundColor: viewBg, touchAction: 'none', cursor }}
      >
        <BoardToolbar
          tool={tool}
          onToolChange={changeTool}
          disabled={Boolean(textEdit)}
          onInsertImage={openImagePicker}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className="hidden"
          data-testid="hip-board-image-input"
          onChange={onFileInputChange}
        />

        <svg
          className="board-scene absolute inset-0 h-full w-full"
          data-testid="hip-board-svg"
        >
          <g className="world" transform={transform} data-testid="hip-board-world">
            {elements.map((el) => {
              // Hide live text while its overlay editor is open.
              if (textEdit?.id === el.id && el.type === 'text') {
                return null
              }
              if (el.type === 'rect') {
                return (
                  <rect
                    key={el.id}
                    x={el.x}
                    y={el.y}
                    width={Math.max(0, el.w)}
                    height={Math.max(0, el.h)}
                    fill={el.fill}
                    stroke={el.stroke}
                    strokeWidth={el.strokeWidth}
                    rx={el.cornerRadius}
                    ry={el.cornerRadius}
                    data-element-id={el.id}
                    data-element-type="rect"
                  />
                )
              }
              if (el.type === 'ellipse') {
                return (
                  <ellipse
                    key={el.id}
                    cx={el.x + el.w / 2}
                    cy={el.y + el.h / 2}
                    rx={Math.abs(el.w) / 2}
                    ry={Math.abs(el.h) / 2}
                    fill={el.fill}
                    stroke={el.stroke}
                    strokeWidth={el.strokeWidth}
                    data-element-id={el.id}
                    data-element-type="ellipse"
                  />
                )
              }
              if (el.type === 'line') {
                return (
                  <line
                    key={el.id}
                    x1={el.x}
                    y1={el.y}
                    x2={el.x2}
                    y2={el.y2}
                    stroke={el.stroke}
                    strokeWidth={el.strokeWidth}
                    data-element-id={el.id}
                    data-element-type="line"
                  />
                )
              }
              if (el.type === 'arrow') {
                const head = arrowHeadPoints(el.x, el.y, el.x2, el.y2, el.strokeWidth)
                return (
                  <g key={el.id} data-element-id={el.id} data-element-type="arrow">
                    <line
                      x1={el.x}
                      y1={el.y}
                      x2={el.x2}
                      y2={el.y2}
                      stroke={el.stroke}
                      strokeWidth={el.strokeWidth}
                    />
                    <polygon points={head} fill={el.stroke} stroke="none" />
                  </g>
                )
              }
              if (el.type === 'text') {
                const lineHeight = textLineHeight(el.fontSize)
                const lines = el.text.split('\n')
                return (
                  <text
                    key={el.id}
                    x={el.x + BOARD_TEXT_PADDING}
                    y={el.y + BOARD_TEXT_PADDING + lineHeight * 0.8}
                    fill={el.fill}
                    fontSize={el.fontSize}
                    fontFamily={TEXT_FONT_FAMILY}
                    data-element-id={el.id}
                    data-element-type="text"
                  >
                    {lines.map((line, i) => (
                      <tspan
                        key={i}
                        x={el.x + BOARD_TEXT_PADDING}
                        dy={i === 0 ? 0 : lineHeight}
                      >
                        {line.length === 0 ? ' ' : line}
                      </tspan>
                    ))}
                  </text>
                )
              }
              if (el.type === 'image') {
                const rt = filesRuntimeRef.current.get(el.fileId)
                if (rt?.url) {
                  return (
                    <image
                      key={el.id}
                      x={el.x}
                      y={el.y}
                      width={Math.max(0, el.w)}
                      height={Math.max(0, el.h)}
                      href={rt.url}
                      preserveAspectRatio="none"
                      data-element-id={el.id}
                      data-element-type="image"
                      data-file-id={el.fileId}
                    />
                  )
                }
                return (
                  <rect
                    key={el.id}
                    x={el.x}
                    y={el.y}
                    width={Math.max(0, el.w)}
                    height={Math.max(0, el.h)}
                    fill="#e5e5e5"
                    stroke="#999"
                    strokeWidth={1}
                    data-element-id={el.id}
                    data-element-type="image"
                    data-file-id={el.fileId}
                  />
                )
              }
              return null
            })}

            {/* Selection outlines + handles (PR-3). */}
            {selectedIds.map((id) => {
              const el = elements.find((x) => x.id === id)
              if (!el) return null
              if (textEdit?.id === id) return null
              const box = elementAabb(el)
              const inv = 1 / (camera.zoom || 1)
              const stroke = 'var(--accent, #3b82f6)'
              const showHandles =
                selectedIds.length === 1 &&
                !el.locked &&
                (isBoxResizable(el) || el.type === 'line' || el.type === 'arrow')
              return (
                <g key={`sel-${id}`} data-testid={`hip-board-selection-${id}`}>
                  <rect
                    x={box.x}
                    y={box.y}
                    width={Math.max(box.w, 0)}
                    height={Math.max(box.h, 0)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={1.5 * inv}
                    strokeDasharray={`${4 * inv} ${3 * inv}`}
                    pointerEvents="none"
                  />
                  {showHandles && isBoxResizable(el)
                    ? (Object.entries(boxHandlePositions(box)) as [
                        BoxHandle,
                        { x: number; y: number },
                      ][]).map(([handle, p]) => {
                        const hs = 7 * inv
                        return (
                          <rect
                            key={handle}
                            x={p.x - hs / 2}
                            y={p.y - hs / 2}
                            width={hs}
                            height={hs}
                            fill="#fff"
                            stroke={stroke}
                            strokeWidth={1 * inv}
                            data-testid={`hip-board-handle-${handle}`}
                            data-handle={handle}
                            style={{ cursor: `${handle}-resize` }}
                          />
                        )
                      })
                    : null}
                  {showHandles && (el.type === 'line' || el.type === 'arrow')
                    ? (['start', 'end'] as const).map((which) => {
                        const px = which === 'start' ? el.x : el.x2
                        const py = which === 'start' ? el.y : el.y2
                        const r = 5 * inv
                        return (
                          <circle
                            key={which}
                            cx={px}
                            cy={py}
                            r={r}
                            fill="#fff"
                            stroke={stroke}
                            strokeWidth={1 * inv}
                            data-testid={`hip-board-endpoint-${which}`}
                            data-handle={which}
                          />
                        )
                      })
                    : null}
                </g>
              )
            })}

            {/* Multi-select union outline (no handles). */}
            {selectedIds.length > 1
              ? (() => {
                  const union = selectionUnionAabb(elements, selectedIds)
                  if (!union) return null
                  const inv = 1 / (camera.zoom || 1)
                  return (
                    <rect
                      data-testid="hip-board-selection-union"
                      x={union.x}
                      y={union.y}
                      width={Math.max(union.w, 0)}
                      height={Math.max(union.h, 0)}
                      fill="none"
                      stroke="var(--accent, #3b82f6)"
                      strokeWidth={1 * inv}
                      strokeOpacity={0.5}
                      pointerEvents="none"
                    />
                  )
                })()
              : null}

            {/* Marquee rubber-band. */}
            {marquee && marquee.w + marquee.h > 0 ? (
              <rect
                data-testid="hip-board-marquee"
                x={marquee.x}
                y={marquee.y}
                width={marquee.w}
                height={marquee.h}
                fill="var(--accent, #3b82f6)"
                fillOpacity={0.08}
                stroke="var(--accent, #3b82f6)"
                strokeWidth={1 / (camera.zoom || 1)}
                strokeDasharray={`${4 / (camera.zoom || 1)} ${3 / (camera.zoom || 1)}`}
                pointerEvents="none"
              />
            ) : null}
          </g>
        </svg>

        {textEdit && textOverlayStyle ? (
          <textarea
            ref={textareaRef}
            data-testid="hip-board-text-edit"
            className="board-text-edit"
            value={textEdit.draft}
            style={textOverlayStyle}
            spellCheck={false}
            onChange={(e) => {
              const draft = e.target.value
              // Normalize only \r\n → \n; never insert soft-wrap breaks.
              const normalized = draft.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
              const st: TextEditState = {
                id: textEdit.id,
                draft: normalized,
                ...(textEdit.isNew ? { isNew: true } : {}),
              }
              textEditRef.current = st
              setTextEdit(st)
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                e.preventDefault()
                commitTextEdit({ cancel: true })
              }
              // Enter inserts newline (default textarea); tool keys stay local.
            }}
            onBlur={() => {
              // Commit on blur unless leave already froze.
              if (!activeRef.current) return
              if (textEditRef.current) commitTextEdit()
            }}
          />
        ) : null}

        {/* Debug hook for coordinate tests without exposing internals */}
        <span className="sr-only" data-testid="hip-board-camera">
          {`${camera.x.toFixed(2)},${camera.y.toFixed(2)},${camera.zoom.toFixed(4)}`}
        </span>
      </div>
    )
  },
)
