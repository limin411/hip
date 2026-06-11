/** 指针离开后，浮层缩回前的宽限时长（ms）—— 防手抖闪烁。 */
export const PEEK_CLOSE_DELAY_MS = 250
/** 浮层滑入 / 滑出动画时长（ms）。面板级缓动统一 200ms ease-out。 */
export const PEEK_ANIM_MS = 200

export interface PeekState {
  /** 浮层可见（已滑入）。宽限期内仍为 true。 */
  open: boolean
  /** 已安排关闭、正在等宽限延迟。 */
  pendingClose: boolean
  /** 不管指针在哪都保持打开（如浮层内的下拉菜单正开着）。 */
  locked: boolean
}

export const initialPeekState: PeekState = { open: false, pendingClose: false, locked: false }

export type PeekEvent =
  | { type: 'enter' } // 指针进入左缘热区或浮层
  | { type: 'leave' } // 指针离开热区与浮层
  | { type: 'closeElapsed' } // 宽限定器到点
  | { type: 'lock' } // 保持打开（下拉打开）
  | { type: 'unlock' } // 解除保持（下拉关闭）
  | { type: 'reset' } // 强制关闭（侧栏已停靠 / 不再折叠）

export function peekReducer(state: PeekState, event: PeekEvent): PeekState {
  switch (event.type) {
    case 'enter':
      return { ...state, open: true, pendingClose: false }
    case 'leave':
      if (state.locked || !state.open) return state
      return { ...state, pendingClose: true }
    case 'closeElapsed':
      if (state.locked) return { ...state, pendingClose: false }
      return { ...state, open: false, pendingClose: false }
    case 'lock':
      return { ...state, locked: true, open: true, pendingClose: false }
    case 'unlock':
      return { ...state, locked: false }
    case 'reset':
      return initialPeekState
    default:
      return state
  }
}
