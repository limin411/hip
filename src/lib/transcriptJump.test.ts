// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/store/uiStore'
import { jumpToTranscriptMessage } from './transcriptJump'

describe('jumpToTranscriptMessage', () => {
  beforeEach(() => {
    useUiStore.setState({ scrollTargetMessageId: null })
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('scrolls the matching node and sets scroll target', () => {
    const node = document.createElement('div')
    node.setAttribute('data-message-id', 'm1')
    const scrollIntoView = vi.fn()
    node.scrollIntoView = scrollIntoView
    document.body.appendChild(node)

    expect(jumpToTranscriptMessage('m1')).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    expect(useUiStore.getState().scrollTargetMessageId).toBe('m1')
  })

  it('still sets target when node is missing', () => {
    expect(jumpToTranscriptMessage('gone')).toBe(false)
    expect(useUiStore.getState().scrollTargetMessageId).toBe('gone')
  })

  it('re-fires when jumping to the same id again', () => {
    useUiStore.setState({ scrollTargetMessageId: 'm1' })
    jumpToTranscriptMessage('m1')
    expect(useUiStore.getState().scrollTargetMessageId).toBe('m1')
  })
})
