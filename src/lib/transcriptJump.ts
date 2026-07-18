import { useUiStore } from '@/store/uiStore'

/**
 * Jump the main transcript to a message immediately (sync scroll), then set
 * scrollTargetMessageId so ChatPane can apply the landing highlight.
 * Returns whether the message node was found in the DOM.
 */
export function jumpToTranscriptMessage(messageId: string): boolean {
  const el = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
  if (el instanceof HTMLElement) {
    // Instant scroll — pin the message to the top of the transcript viewport.
    el.scrollIntoView({ block: 'start', behavior: 'auto' })
  }

  const st = useUiStore.getState()
  // Re-selecting the same id must re-fire the highlight effect.
  if (st.scrollTargetMessageId === messageId) {
    useUiStore.setState({ scrollTargetMessageId: null })
  }
  useUiStore.getState().setScrollTarget(messageId)
  return el instanceof HTMLElement
}
