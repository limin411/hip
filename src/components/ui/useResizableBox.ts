import { useCallback, useEffect, useRef, useState } from 'react'

export type Size = { width: number; height: number }
export type ResizeDir =
  | 'top' | 'bottom' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

// Per-direction sign for each axis. The modal is centered, so dragging one edge
// moves both — see the ×2 in onResizeStart.
const DIR_SIGN: Record<ResizeDir, { sx: number; sy: number }> = {
  right: { sx: 1, sy: 0 },
  left: { sx: -1, sy: 0 },
  bottom: { sx: 0, sy: 1 },
  top: { sx: 0, sy: -1 },
  'bottom-right': { sx: 1, sy: 1 },
  'bottom-left': { sx: -1, sy: 1 },
  'top-right': { sx: 1, sy: -1 },
  'top-left': { sx: -1, sy: -1 },
}

function clampToViewport(s: Size, min: Size): Size {
  const maxW = Math.max(min.width, Math.round(window.innerWidth * 0.96))
  const maxH = Math.max(min.height, Math.round(window.innerHeight * 0.92))
  return {
    width: Math.max(min.width, Math.min(s.width, maxW)),
    height: Math.max(min.height, Math.min(s.height, maxH)),
  }
}

interface Options {
  enabled: boolean
  defaultSize: Size
  minSize: Size
  storageKey?: string
}

export function useResizableBox({ enabled, defaultSize, minSize, storageKey }: Options) {
  const [size, setSize] = useState<Size>(defaultSize)
  const latest = useRef<Size>(defaultSize)
  const drag = useRef<{ dir: ResizeDir; x: number; y: number; w: number; h: number } | null>(null)
  // Tear-down for an in-flight drag; held in a ref so the unmount effect can run it.
  const teardown = useRef<(() => void) | null>(null)

  const apply = useCallback((s: Size) => {
    latest.current = s
    setSize(s)
  }, [])

  useEffect(() => {
    if (!enabled) return
    let initial = defaultSize
    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey)
        const parsed = raw ? JSON.parse(raw) : null
        if (typeof parsed?.width === 'number' && typeof parsed?.height === 'number') {
          initial = { width: parsed.width, height: parsed.height }
        }
      } catch {
        /* ignore malformed storage */
      }
    }
    apply(clampToViewport(initial, minSize))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // If the modal unmounts mid-drag (e.g. Escape closes it while a handle is held),
  // tear the drag down so window listeners and body.userSelect never leak.
  useEffect(() => () => teardown.current?.(), [])

  const onResizeStart = useCallback(
    (dir: ResizeDir, e: React.PointerEvent) => {
      if (!enabled || drag.current) return
      e.preventDefault()
      drag.current = { dir, x: e.clientX, y: e.clientY, w: latest.current.width, h: latest.current.height }

      const onMove = (ev: PointerEvent) => {
        const d = drag.current
        if (!d) return
        const { sx, sy } = DIR_SIGN[d.dir]
        // ×2: the centered modal grows on both sides, so 1px of handle travel = 2px of size.
        apply(
          clampToViewport(
            { width: d.w + 2 * sx * (ev.clientX - d.x), height: d.h + 2 * sy * (ev.clientY - d.y) },
            minSize,
          ),
        )
      }
      const finish = () => {
        if (!drag.current) return
        drag.current = null
        teardown.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        document.body.style.userSelect = ''
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, JSON.stringify(latest.current))
          } catch {
            /* ignore quota errors */
          }
        }
      }
      const onUp = (ev: PointerEvent) => {
        if (ev.button !== 0) return
        finish()
      }
      const onCancel = () => finish()

      teardown.current = finish
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
    },
    [enabled, minSize, storageKey, apply],
  )

  return { size, onResizeStart }
}
