import { useEffect, useMemo, useReducer } from 'react'
import { ChevronRight, Pin } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import { peekReducer, initialPeekState, PEEK_CLOSE_DELAY_MS, PEEK_ANIM_MS } from '@/lib/hoverPeek'
import { Sidebar } from './Sidebar'
import { SidebarPeekLockContext } from './sidebarPeekContext'

/** 浮层宽度（px）—— 舒适阅读宽度，独立于停靠态面板尺寸。 */
const PEEK_WIDTH = 260

export function SidebarPeek() {
  const collapsed = useUiStore((s) => s.collapsed)
  const setCollapsed = useUiStore((s) => s.setCollapsed)
  const [state, dispatch] = useReducer(peekReducer, initialPeekState)

  // 侧栏重新停靠时，强制关闭浮层。
  useEffect(() => {
    if (!collapsed) dispatch({ type: 'reset' })
  }, [collapsed])

  // 有待关闭时跑宽限定器。
  useEffect(() => {
    if (!state.pendingClose) return
    const t = setTimeout(() => dispatch({ type: 'closeElapsed' }), PEEK_CLOSE_DELAY_MS)
    return () => clearTimeout(t)
  }, [state.pendingClose])

  const lockValue = useMemo(
    () => ({ lock: () => dispatch({ type: 'lock' }), unlock: () => dispatch({ type: 'unlock' }) }),
    [],
  )

  if (!collapsed) return null

  return (
    <>
      {/* 左缘 hover 热区 + 发现用 chevron；可见的「淡线」是底下的 PanelResizeHandle。 */}
      <div
        aria-hidden
        onMouseEnter={() => dispatch({ type: 'enter' })}
        className="group absolute left-0 top-0 z-30 h-full w-3"
      >
        <ChevronRight
          size={16}
          className="absolute left-0.5 top-1/2 -translate-y-1/2 rounded bg-surface text-ink-tertiary opacity-0 shadow-pop transition-opacity group-hover:opacity-100"
        />
      </div>

      {/* 滑动浮层侧栏。 */}
      <aside
        onMouseEnter={() => dispatch({ type: 'enter' })}
        onMouseLeave={() => dispatch({ type: 'leave' })}
        style={{ width: PEEK_WIDTH, transitionDuration: `${PEEK_ANIM_MS}ms` }}
        className={cn(
          'absolute left-0 top-0 z-40 h-full border-r border-border shadow-float transition-transform ease-out motion-reduce:transition-none',
          state.open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <SidebarPeekLockContext.Provider value={lockValue}>
          <div className="relative h-full">
            {/* 图钉 = 停靠（变回常驻）。位置可在打磨阶段微调，避免与「新对话」按钮视觉相撞。 */}
            <button
              onClick={() => setCollapsed(false)}
              title="固定侧边栏"
              className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-surface text-ink-tertiary shadow-pop transition-colors hover:text-ink"
            >
              <Pin size={15} />
            </button>
            <Sidebar />
          </div>
        </SidebarPeekLockContext.Provider>
      </aside>
    </>
  )
}
