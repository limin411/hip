import { useUiStore } from '@/store/uiStore'

/** Marker on ChatPane's overflow scroller — nested scrollIntoView is unreliable in WKWebView. */
export const TRANSCRIPT_SCROLL_ATTR = 'data-transcript-scroll'

/**
 * Pin a message node to the top of the transcript scroller by setting scrollTop
 * directly. Falls back to scrollIntoView only when the scroller marker is missing.
 */
export function scrollTranscriptToMessage(messageId: string): boolean {
  const el = document.querySelector(
    `[data-message-id="${CSS.escape(messageId)}"]`,
  )
  if (!(el instanceof HTMLElement)) return false

  const scroller = el.closest(`[${TRANSCRIPT_SCROLL_ATTR}]`)
  if (scroller instanceof HTMLElement) {
    const elRect = el.getBoundingClientRect()
    const scRect = scroller.getBoundingClientRect()
    scroller.scrollTop += elRect.top - scRect.top
    return true
  }

  el.scrollIntoView({ block: 'start', behavior: 'auto' })
  return true
}

/**
 * Jump the main transcript to a message immediately (sync scroll), then set
 * scrollTargetMessageId so ChatPane can apply the landing highlight.
 * Returns whether the message node was found in the DOM.
 */
export function jumpToTranscriptMessage(messageId: string): boolean {
  const found = scrollTranscriptToMessage(messageId)

  const st = useUiStore.getState()
  // Re-selecting the same id must re-fire the highlight effect.
  if (st.scrollTargetMessageId === messageId) {
    useUiStore.setState({ scrollTargetMessageId: null })
  }
  useUiStore.getState().setScrollTarget(messageId)
  return found
}
