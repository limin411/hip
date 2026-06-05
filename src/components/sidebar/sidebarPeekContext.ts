import { createContext } from 'react'

export interface SidebarPeekLock {
  /** 保持浮层打开（如内部下拉菜单打开时）。 */
  lock: () => void
  /** 解除之前的保持。 */
  unlock: () => void
}

/** 由 SidebarPeek 向其浮层子树提供；不在浮层里时为 null。 */
export const SidebarPeekLockContext = createContext<SidebarPeekLock | null>(null)
