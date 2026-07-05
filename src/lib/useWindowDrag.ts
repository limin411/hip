import { useCallback, useEffect, useRef } from 'react'

const DRAG_THRESHOLD = 4

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function isNoDragTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return (
    target.closest('button') !== null || target.closest('[data-no-drag]') !== null
  )
}

let windowApi: typeof import('@tauri-apps/api/window') | null = null

async function startDrag() {
  if (!isTauriRuntime()) return
  if (!windowApi) {
    try {
      windowApi = await import('@tauri-apps/api/window')
    } catch {
      return
    }
  }
  void windowApi.getCurrentWindow().startDragging()
}

/**
 * 为整个标题栏提供“按住并移动即拖动窗口”的行为。
 *
 * Tauri 的 `data-tauri-drag-region` 会把整片元素变成拖拽区，但子元素
 * 一旦标记 `data-tauri-drag-region="false"` 就会完全排除。对于顶部标签栏
 * 这种几乎被 tab 占满的区域，只剩极小的缝隙可拖。
 *
 * 这个 hook 改用手动调用 `getCurrentWindow().startDragging()`：
 * - 按下时记录起点；
 * - 移动超过阈值后开始拖动窗口；
 * - 没有移动就放行，让普通的 click 事件触发（如切换 tab）。
 */
export function useWindowDrag() {
  const dragging = useRef(false)
  const start = useRef<{ x: number; y: number } | null>(null)

  const handleMoveRef = useRef((e: PointerEvent) => {
    if (dragging.current) return
    const s = start.current
    if (!s) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragging.current = true
      cleanup()
      void startDrag()
    }
  })

  const handleUpRef = useRef(() => {
    cleanup()
  })

  function cleanup() {
    dragging.current = false
    start.current = null
    window.removeEventListener('pointermove', handleMoveRef.current)
    window.removeEventListener('pointerup', handleUpRef.current)
  }

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    if (isNoDragTarget(e.target)) return
    dragging.current = false
    start.current = { x: e.clientX, y: e.clientY }
    window.addEventListener('pointermove', handleMoveRef.current)
    window.addEventListener('pointerup', handleUpRef.current)
  }, [])

  useEffect(() => () => cleanup(), [])

  return onPointerDown
}
