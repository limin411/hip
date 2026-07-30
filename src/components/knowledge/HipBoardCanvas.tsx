/**
 * Hip SVG whiteboard shell (PR-1).
 *
 * Empty scene + pan/zoom only. Not mounted from KnowledgeWorkspace until PR-C.
 * Camera is session-only — pan/zoom never call setDraftBody (LKD-14).
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
} from '@/domain/knowledge/boardScene'
import {
  clampCamera,
  worldGroupTransform,
  zoomAtScreenPoint,
} from '@/domain/knowledge/boardOps'
import type { FlushToStoreOpts, KnowledgeBoardCanvasHandle } from './KnowledgeBoardCanvas'

export type StylePatch = Partial<{
  fill: string
  stroke: string
  strokeWidth: number
  fontSize: 12 | 16 | 24
  cornerRadius: number
}>

/** Extended handle for PR-2+; PR-1 stubs selection/style APIs. */
export type HipBoardCanvasHandle = KnowledgeBoardCanvasHandle & {
  isReady: () => boolean
  selectAndScrollTo: (ids: string[]) => void
  applyStylePatch: (ids: string[], patch: StylePatch) => void
  updateText: (id: string, text: string) => void
  /** Test / debug: current session camera (not on disk). */
  getCamera: () => HipBoardCamera
}

export type HipBoardCanvasProps = {
  boardId: string
  spaceId: string
  /** Dehydrated hip-board (or dual-parse) JSON. Mount once; uncontrolled after. */
  initialJson: string
  /**
   * Optional draft writer — PR-1 shell never calls this for camera-only ops.
   * Wired for future shape tools / tests that inject a spy.
   */
  onDraftBody?: (raw: string, opts: { docId: string; persist: 'auto' | 'none' }) => void
}

const WHEEL_ZOOM_SENSITIVITY = 0.0015

export const HipBoardCanvas = forwardRef<HipBoardCanvasHandle, HipBoardCanvasProps>(
  function HipBoardCanvas({ boardId, spaceId: _spaceId, initialJson, onDraftBody }, ref) {
    const rootRef = useRef<HTMLDivElement>(null)
    const elementsRef = useRef<HipBoardElement[]>([])
    const filesRelRef = useRef<Record<string, string>>({})
    const viewBgRef = useRef('#ffffff')
    const cameraRef = useRef<HipBoardCamera>({ ...HIP_BOARD_DEFAULT_CAMERA })
    const activeRef = useRef(true)
    const boardIdRef = useRef(boardId)
    boardIdRef.current = boardId
    const lastSerializedRef = useRef<string>('')
    const readyRef = useRef(false)

    const [camera, setCamera] = useState<HipBoardCamera>(() => ({
      ...HIP_BOARD_DEFAULT_CAMERA,
    }))
    const [viewBg, setViewBg] = useState('#ffffff')
    const [elements, setElements] = useState<HipBoardElement[]>([])

    // Pan gesture state (session only).
    const panRef = useRef<{
      pointerId: number
      startSX: number
      startSY: number
      originX: number
      originY: number
    } | null>(null)

    useLayoutEffect(() => {
      activeRef.current = true
      readyRef.current = false

      let scene: HipBoardSceneDisk = EMPTY_HIP_BOARD_SCENE
      try {
        const parsed = parseBoardScene(initialJson || EMPTY_HIP_BOARD_SCENE_JSON)
        if (parsed.type === 'hip-board') {
          scene = parsed
        } else {
          // Dual-parse accepted excalidraw, but this shell only renders hip-board.
          // Production cutover + migrate happen in PR-C; keep empty hip for shell.
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
      readyRef.current = true

      return () => {
        activeRef.current = false
        readyRef.current = false
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

    const flushToStore = useCallback(
      (opts?: FlushToStoreOpts) => {
        if (!activeRef.current && opts?.mode !== 'leave') return
        const raw = buildDiskJson()
        lastSerializedRef.current = raw
        onDraftBody?.(raw, { docId: boardIdRef.current, persist: 'none' })
        if (opts?.mode === 'leave') {
          activeRef.current = false
        }
      },
      [buildDiskJson, onDraftBody],
    )

    useImperativeHandle(
      ref,
      () => ({
        flushToStore,
        exportPngBlob: async () => null,
        isReady: () => readyRef.current && activeRef.current,
        selectAndScrollTo: () => {
          /* PR-3 */
        },
        applyStylePatch: () => {
          /* PR-2/4 */
        },
        updateText: () => {
          /* PR-2 */
        },
        getCamera: () => ({ ...cameraRef.current }),
      }),
      [flushToStore],
    )

    useEffect(() => {
      return () => {
        activeRef.current = false
      }
    }, [])

    const applyCamera = useCallback((next: HipBoardCamera) => {
      const c = clampCamera(next)
      cameraRef.current = c
      setCamera(c)
      // LKD-14: camera-only — never setDraftBody / onDraftBody
    }, [])

    const onWheel = useCallback(
      (e: React.WheelEvent) => {
        e.preventDefault()
        const rect = rootRef.current?.getBoundingClientRect()
        if (!rect) return
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)
        const nextZoom = cameraRef.current.zoom * factor
        applyCamera(zoomAtScreenPoint(cameraRef.current, sx, sy, nextZoom))
      },
      [applyCamera],
    )

    const onPointerDown = useCallback((e: React.PointerEvent) => {
      // PR-1 shell: primary or middle drag pans (no select tool yet). Camera-only.
      if (e.button !== 0 && e.button !== 1) return
      e.currentTarget.setPointerCapture(e.pointerId)
      panRef.current = {
        pointerId: e.pointerId,
        startSX: e.clientX,
        startSY: e.clientY,
        originX: cameraRef.current.x,
        originY: cameraRef.current.y,
      }
    }, [])

    const onPointerMove = useCallback(
      (e: React.PointerEvent) => {
        const pan = panRef.current
        if (!pan || pan.pointerId !== e.pointerId) return
        const dx = e.clientX - pan.startSX
        const dy = e.clientY - pan.startSY
        applyCamera({
          ...cameraRef.current,
          x: pan.originX + dx,
          y: pan.originY + dy,
        })
      },
      [applyCamera],
    )

    const onPointerUp = useCallback((e: React.PointerEvent) => {
      if (panRef.current?.pointerId === e.pointerId) {
        panRef.current = null
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          /* already released */
        }
      }
    }, [])

    const transform = worldGroupTransform(camera)

    return (
      <div
        ref={rootRef}
        className="board-root relative h-full w-full min-h-[200px] overflow-hidden outline-none"
        data-testid="knowledge-board-canvas"
        data-engine="hip"
        data-board-id={boardId}
        tabIndex={0}
        aria-label="Whiteboard"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ backgroundColor: viewBg, touchAction: 'none' }}
      >
        <svg
          className="board-scene absolute inset-0 h-full w-full"
          data-testid="hip-board-svg"
        >
          <g className="world" transform={transform} data-testid="hip-board-world">
            {elements.map((el) => {
              if (el.type === 'rect') {
                return (
                  <rect
                    key={el.id}
                    x={el.x}
                    y={el.y}
                    width={el.w}
                    height={el.h}
                    fill={el.fill}
                    stroke={el.stroke}
                    strokeWidth={el.strokeWidth}
                    rx={el.cornerRadius}
                    ry={el.cornerRadius}
                    data-element-id={el.id}
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
                  />
                )
              }
              if (el.type === 'line' || el.type === 'arrow') {
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
                  />
                )
              }
              if (el.type === 'text') {
                const lineHeight = el.fontSize * 1.25
                const lines = el.text.split('\n')
                return (
                  <text
                    key={el.id}
                    x={el.x + 4}
                    y={el.y + 4 + lineHeight * 0.8}
                    fill={el.fill}
                    fontSize={el.fontSize}
                    fontFamily="ui-sans-serif, system-ui, sans-serif"
                    data-element-id={el.id}
                  >
                    {lines.map((line, i) => (
                      <tspan
                        key={i}
                        x={el.x + 4}
                        dy={i === 0 ? 0 : lineHeight}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                )
              }
              if (el.type === 'image') {
                // image: PR-5 — placeholder rect
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
                    data-file-id={el.fileId}
                  />
                )
              }
              return null
            })}
          </g>
        </svg>
        {/* Debug hook for coordinate tests without exposing internals */}
        <span className="sr-only" data-testid="hip-board-camera">
          {`${camera.x.toFixed(2)},${camera.y.toFixed(2)},${camera.zoom.toFixed(4)}`}
        </span>
      </div>
    )
  },
)
