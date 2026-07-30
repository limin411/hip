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

/**
 * Clamp size into [effMin, max] where max is ~96%×92% of the viewport and
 * effMin never exceeds max (small windows must not stick at DEFAULT_MIN).
 * Exported for unit tests.
 */
export function clampToViewport(s: Size, min: Size): Size {
  if (typeof window === 'undefined') return s
  const maxW = Math.round(window.innerWidth * 0.96)
  const maxH = Math.round(window.innerHeight * 0.92)
  const effMinW = Math.min(min.width, maxW)
  const effMinH = Math.min(min.height, maxH)
  return {
    width: Math.max(effMinW, Math.min(s.width, maxW)),
    height: Math.max(effMinH, Math.min(s.height, maxH)),
  }
}

function readStoredSize(storageKey: string | undefined, defaultSize: Size, minSize: Size): Size {
  let initial = defaultSize
  if (storageKey && typeof window !== 'undefined') {
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
  return clampToViewport(initial, minSize)
}

interface Options {
  enabled: boolean
  defaultSize: Size
  minSize: Size
  storageKey?: string
}

export function useResizableBox({ enabled, defaultSize, minSize, storageKey }: Options) {
  // Read storage + clamp on first paint so open does not flash defaultSize then jump.
  const [size, setSize] = useState<Size>(() =>
    enabled ? readStoredSize(storageKey, defaultSize, minSize) : defaultSize,
  )
  const latest = useRef<Size>(size)
  const drag = useRef<{ dir: ResizeDir; x: number; y: number; w: number; h: number } | null>(null)
  // Tear-down for an in-flight drag; held in a ref so the unmount effect can run it.
  const teardown = useRef<(() => void) | null>(null)
  // Keep minSize readable from the resize listener without rebinding on every object identity.
  const minSizeRef = useRef(minSize)
  minSizeRef.current = minSize

  const apply = useCallback((s: Size) => {
    latest.current = s
    setSize(s)
  }, [])

  // Re-read storage + clamp when enabled, or when size sources change while enabled.
  useEffect(() => {
    if (!enabled) return
    apply(readStoredSize(storageKey, defaultSize, minSize))
    // Primitive deps so inline { width, height } from parents do not thrash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    storageKey,
    defaultSize.width,
    defaultSize.height,
    minSize.width,
    minSize.height,
    apply,
  ])

  // Re-clamp current size when the window shrinks/grows (min must never exceed max).
  useEffect(() => {
    if (!enabled) return
    const onResize = () => {
      apply(clampToViewport(latest.current, minSizeRef.current))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [enabled, apply])

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
            minSizeRef.current,
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
    [enabled, storageKey, apply],
  )

  return { size, onResizeStart }
}
