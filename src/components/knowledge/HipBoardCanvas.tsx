/**
 * Hip SVG whiteboard (PR-2: shape + text tools).
 *
 * Not mounted from KnowledgeWorkspace until PR-C.
 * Camera is session-only — pan/zoom never call setDraftBody (LKD-14).
 * Draft throttle only when dehydrated scene serializes differently.
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
import {
  EMPTY_HIP_BOARD_SCENE,
  EMPTY_HIP_BOARD_SCENE_JSON,
  HIP_BOARD_DEFAULT_CAMERA,
  buildHipDiskScene,
  parseBoardScene,
  serializeHipBoard,
  type HipBoardCamera,
  type HipBoardElement,
  type HipBoardSceneDisk,
  type HipBoardText,
} from '@/domain/knowledge/boardScene'
import {
  BOARD_DEFAULT_CORNER_RADIUS,
  BOARD_DEFAULT_FILL,
  BOARD_DEFAULT_STROKE,
  BOARD_DEFAULT_STROKE_WIDTH,
  BOARD_TEXT_DEFAULT_FONT_SIZE,
  BOARD_TEXT_DEFAULT_W,
  BOARD_TEXT_PADDING,
  arrowHeadPoints,
  clampCamera,
  elementAabb,
  hitTest,
  isTinyBox,
  isTinyLine,
  measureTextHeight,
  normalizeRectFromDrag,
  screenToWorld,
  textLineHeight,
  worldGroupTransform,
  worldToScreen,
  zoomAtScreenPoint,
  type BoardTool,
} from '@/domain/knowledge/boardOps'
import type { FlushToStoreOpts, KnowledgeBoardCanvasHandle } from './KnowledgeBoardCanvas'
import { BoardToolbar } from './BoardToolbar'

export type StylePatch = Partial<{
  fill: string
  stroke: string
  strokeWidth: number
  fontSize: 12 | 16 | 24
  cornerRadius: number
}>

/** Extended handle for PR-2+; selection/transform fill in PR-3. */
export type HipBoardCanvasHandle = KnowledgeBoardCanvasHandle & {
  isReady: () => boolean
  selectAndScrollTo: (ids: string[]) => void
  applyStylePatch: (ids: string[], patch: StylePatch) => void
  updateText: (id: string, text: string) => void
  /** Test / debug: current session camera (not on disk). */
  getCamera: () => HipBoardCamera
  /** Test / debug: current tool. */
  getTool: () => BoardTool
  /** Test / debug: selected element ids. */
  getSelectedIds: () => string[]
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
    }

type TextEditState = {
  id: string
  draft: string
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
  function HipBoardCanvas({ boardId, spaceId: _spaceId, initialJson, onDraftBody }, ref) {
    const rootRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const elementsRef = useRef<HipBoardElement[]>([])
    const filesRelRef = useRef<Record<string, string>>({})
    const viewBgRef = useRef('#ffffff')
    const cameraRef = useRef<HipBoardCamera>({ ...HIP_BOARD_DEFAULT_CAMERA })
    const activeRef = useRef(true)
    const boardIdRef = useRef(boardId)
    boardIdRef.current = boardId
    const lastSerializedRef = useRef<string>('')
    const readyRef = useRef(false)
    const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const gestureRef = useRef<Gesture | null>(null)
    const spaceDownRef = useRef(false)
    const toolRef = useRef<BoardTool>('select')
    const selectedIdsRef = useRef<string[]>([])
    const textEditOriginalRef = useRef<string>('')
    const textEditRef = useRef<TextEditState | null>(null)

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

    toolRef.current = tool
    selectedIdsRef.current = selectedIds
    textEditRef.current = textEdit

    const clearThrottle = useCallback(() => {
      if (throttleTimerRef.current != null) {
        clearTimeout(throttleTimerRef.current)
        throttleTimerRef.current = null
      }
    }, [])

    useLayoutEffect(() => {
      activeRef.current = true
      readyRef.current = false
      clearThrottle()
      gestureRef.current = null
      spaceDownRef.current = false
      textEditOriginalRef.current = ''
      textEditRef.current = null

      let scene: HipBoardSceneDisk = EMPTY_HIP_BOARD_SCENE
      try {
        const parsed = parseBoardScene(initialJson || EMPTY_HIP_BOARD_SCENE_JSON)
        if (parsed.type === 'hip-board') {
          scene = parsed
        } else {
          // Dual-parse accepted excalidraw, but this canvas only renders hip-board.
          // Production cutover + migrate happen in PR-C; keep empty hip for now.
          scene = EMPTY_HIP_BOARD_SCENE
        }
      } catch {
        scene = EMPTY_HIP_BOARD_SCENE
      }

      elementsRef.current = scene.elements
      viewBgRef.current = scene.appState.viewBackgroundColor || '#ffffff'
      const rel: Record<string, string> = {}
      for (const [id, f] of Object.entries(scene.files ?? {})) {
        if (f?.hipAssetRel) rel[id] = f.hipAssetRel
      }
      filesRelRef.current = rel
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

      return () => {
        activeRef.current = false
        readyRef.current = false
        clearThrottle()
        gestureRef.current = null
      }
      // Mount once per boardId (parent keys remount).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boardId])

    const buildDiskJson = useCallback((): string => {
      const scene = buildHipDiskScene({
        elements: elementsRef.current,
        appState: { viewBackgroundColor: viewBgRef.current },
        relByFileId: filesRelRef.current,
        boardId: boardIdRef.current,
      })
      return serializeHipBoard(scene)
    }, [])

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
        onDraftBody?.(raw, { docId: boardIdRef.current, persist: 'auto' })
      }, THROTTLE_MS)
    }, [buildDiskJson, onDraftBody])

    const setElementsBoth = useCallback(
      (next: HipBoardElement[], opts?: { draft?: boolean }) => {
        elementsRef.current = next
        setElements(next)
        if (opts?.draft !== false) scheduleDraftAuto()
      },
      [scheduleDraftAuto],
    )

    const setSelection = useCallback((ids: string[]) => {
      selectedIdsRef.current = ids
      setSelectedIds(ids)
      // Selection-only — never schedule draft (LKD-14 / LKD-16)
    }, [])

    const changeTool = useCallback((next: BoardTool) => {
      if (!activeRef.current) return
      if (textEditRef.current) return
      toolRef.current = next
      setTool(next)
    }, [])

    const commitTextEdit = useCallback(
      (opts?: { cancel?: boolean }) => {
        const edit = textEditRef.current
        if (!edit) return
        const el = elementsRef.current.find((e) => e.id === edit.id)
        if (!el || el.type !== 'text') {
          textEditRef.current = null
          setTextEdit(null)
          return
        }
        if (opts?.cancel) {
          // Restore original; drop empty brand-new text created this session.
          const original = textEditOriginalRef.current
          if (original === '' && el.text === '') {
            setElementsBoth(
              elementsRef.current.filter((e) => e.id !== edit.id),
            )
          } else if (el.text !== original || el.h !== measureTextHeight(original, el.fontSize)) {
            const restored: HipBoardText = {
              ...el,
              text: original,
              h: measureTextHeight(original, el.fontSize),
            }
            setElementsBoth(
              elementsRef.current.map((e) => (e.id === edit.id ? restored : e)),
            )
          }
        } else {
          const nextText = edit.draft
          const h = measureTextHeight(nextText, el.fontSize)
          if (el.text !== nextText || el.h !== h) {
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
      [setElementsBoth],
    )

    const beginTextEdit = useCallback(
      (id: string) => {
        if (!activeRef.current) return
        const el = elementsRef.current.find((e) => e.id === id)
        if (!el || el.type !== 'text') return
        if (el.locked) return
        // Commit any prior edit first.
        if (textEditRef.current && textEditRef.current.id !== id) {
          commitTextEdit()
        }
        textEditOriginalRef.current = el.text
        const state: TextEditState = { id, draft: el.text }
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
      [commitTextEdit, setSelection],
    )

    const flushToStore = useCallback(
      (opts?: FlushToStoreOpts) => {
        const isLeave = opts?.mode === 'leave'
        // KD-13: freeze first on leave so concurrent input cannot re-dirty.
        if (isLeave) {
          activeRef.current = false
          gestureRef.current = null
          clearThrottle()
          // Commit in-progress text into elements before serializing (no cancel).
          const edit = textEditRef.current
          if (edit) {
            const el = elementsRef.current.find((e) => e.id === edit.id)
            if (el && el.type === 'text') {
              const h = measureTextHeight(edit.draft, el.fontSize)
              elementsRef.current = elementsRef.current.map((e) =>
                e.id === edit.id && e.type === 'text'
                  ? { ...e, text: edit.draft, h }
                  : e,
              )
            }
            textEditRef.current = null
            setTextEdit(null)
          }
        } else if (!activeRef.current) {
          return
        }
        const raw = buildDiskJson()
        lastSerializedRef.current = raw
        onDraftBody?.(raw, { docId: boardIdRef.current, persist: 'none' })
      },
      [buildDiskJson, clearThrottle, onDraftBody],
    )

    const applyStylePatch = useCallback(
      (ids: string[], patch: StylePatch) => {
        if (!activeRef.current) return
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
        if (changed) setElementsBoth(next)
      },
      [setElementsBoth],
    )

    const updateText = useCallback(
      (id: string, text: string) => {
        if (!activeRef.current) return
        const el = elementsRef.current.find((e) => e.id === id)
        if (!el || el.type !== 'text' || el.locked) return
        const h = measureTextHeight(text, el.fontSize)
        if (el.text === text && el.h === h) return
        setElementsBoth(
          elementsRef.current.map((e) =>
            e.id === id && e.type === 'text' ? { ...e, text, h } : e,
          ),
        )
        if (textEditRef.current?.id === id) {
          const st = { id, draft: text }
          textEditRef.current = st
          setTextEdit(st)
        }
      },
      [setElementsBoth],
    )

    useImperativeHandle(
      ref,
      () => ({
        flushToStore,
        exportPngBlob: async () => null,
        isReady: () => readyRef.current && activeRef.current,
        selectAndScrollTo: (ids: string[]) => {
          if (!activeRef.current) return
          if (textEditRef.current) commitTextEdit()
          setSelection(ids)
          // Scroll/camera fit deferred to PR-3/4.
        },
        applyStylePatch,
        updateText,
        getCamera: () => ({ ...cameraRef.current }),
        getTool: () => toolRef.current,
        getSelectedIds: () => [...selectedIdsRef.current],
      }),
      [applyStylePatch, commitTextEdit, flushToStore, setSelection, updateText],
    )

    useEffect(() => {
      return () => {
        activeRef.current = false
        clearThrottle()
      }
    }, [clearThrottle])

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
        setElementsBoth([...elementsRef.current, el])
        setSelection([id])
        // Switch off text tool before edit (changeTool no-ops while editing).
        toolRef.current = 'select'
        setTool('select')
        beginTextEdit(id)
      },
      [beginTextEdit, setElementsBoth, setSelection],
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
          const el = createShapeAt(currentTool, world.x, world.y)
          e.currentTarget.setPointerCapture(e.pointerId)
          gestureRef.current = {
            kind: 'create',
            pointerId: e.pointerId,
            tool: currentTool,
            elementId: el.id,
            startWX: world.x,
            startWY: world.y,
          }
          setElementsBoth([...elementsRef.current, el], { draft: false })
          setSelection([el.id])
          return
        }

        // Select tool (PR-2 stub): click select / clear. Marquee/move in PR-3.
        if (currentTool === 'select') {
          const hit = hitTest(
            elementsRef.current,
            world.x,
            world.y,
            cameraRef.current.zoom,
          )
          if (hit) {
            setSelection([hit])
          } else {
            setSelection([])
          }
        }
      },
      [
        clientToWorld,
        commitTextEdit,
        createShapeAt,
        placeTextAt,
        setElementsBoth,
        setSelection,
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
          // Commit scene change → throttle draft.
          scheduleDraftAuto()
          // Stay on shape tool for multi-draw (common whiteboard UX).
        }
      },
      [scheduleDraftAuto, setElementsBoth, setSelection],
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

        // While editing text: tool shortcuts disabled.
        if (textEditRef.current) return
        if (isEditableTarget(e.target)) return

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
      [beginTextEdit, changeTool, commitTextEdit, setSelection],
    )

    const onKeyUp = useCallback((e: React.KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDownRef.current = false
      }
    }, [])

    const transform = worldGroupTransform(camera)

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
        style={{ backgroundColor: viewBg, touchAction: 'none', cursor }}
      >
        <BoardToolbar
          tool={tool}
          onToolChange={changeTool}
          disabled={Boolean(textEdit)}
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
                return (
                  <rect
                    key={el.id}
                    x={el.x}
                    y={el.y}
                    width={el.w}
                    height={el.h}
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

            {/* Lightweight selection outline (handles/marquee in PR-3). */}
            {selectedIds.map((id) => {
              const el = elements.find((x) => x.id === id)
              if (!el) return null
              if (textEdit?.id === id) return null
              const box = elementAabb(el)
              const inv = 1 / (camera.zoom || 1)
              return (
                <rect
                  key={`sel-${id}`}
                  x={box.x}
                  y={box.y}
                  width={Math.max(box.w, 0)}
                  height={Math.max(box.h, 0)}
                  fill="none"
                  stroke="var(--accent, #3b82f6)"
                  strokeWidth={1.5 * inv}
                  strokeDasharray={`${4 * inv} ${3 * inv}`}
                  pointerEvents="none"
                  data-testid={`hip-board-selection-${id}`}
                />
              )
            })}
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
              const st = { id: textEdit.id, draft: normalized }
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
