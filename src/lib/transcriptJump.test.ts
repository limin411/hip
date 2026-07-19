// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/store/uiStore'
import { jumpToTranscriptMessage, scrollTranscriptToMessage } from './transcriptJump'

describe('scrollTranscriptToMessage', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('sets scrollTop on the transcript scroller relative to the message', () => {
    const scroller = document.createElement('div')
    scroller.setAttribute('data-transcript-scroll', '')
    Object.defineProperty(scroller, 'scrollTop', {
      value: 400,
      writable: true,
      configurable: true,
    })
    scroller.getBoundingClientRect = () =>
      ({ top: 100, bottom: 500, left: 0, right: 300, width: 300, height: 400, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect

    const node = document.createElement('div')
    node.setAttribute('data-message-id', 'm1')
    node.getBoundingClientRect = () =>
      ({ top: 40, bottom: 80, left: 0, right: 300, width: 300, height: 40, x: 0, y: 40, toJSON: () => ({}) }) as DOMRect
    scroller.appendChild(node)
    document.body.appendChild(scroller)

    expect(scrollTranscriptToMessage('m1')).toBe(true)
    // delta = 40 - 100 = -60 → scrollTop 400 + (-60) = 340
    expect(scroller.scrollTop).toBe(340)
  })

  it('falls back to scrollIntoView when scroller marker is missing', () => {
    const node = document.createElement('div')
    node.setAttribute('data-message-id', 'm1')
    const scrollIntoView = vi.fn()
    node.scrollIntoView = scrollIntoView
    document.body.appendChild(node)

    expect(scrollTranscriptToMessage('m1')).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
  })
})

describe('jumpToTranscriptMessage', () => {
  beforeEach(() => {
    useUiStore.setState({ scrollTargetMessageId: null })
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('scrolls the matching node and sets scroll target', () => {
    const scroller = document.createElement('div')
    scroller.setAttribute('data-transcript-scroll', '')
    Object.defineProperty(scroller, 'scrollTop', { value: 0, writable: true, configurable: true })
    scroller.getBoundingClientRect = () =>
      ({ top: 0, bottom: 400, left: 0, right: 300, width: 300, height: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    const node = document.createElement('div')
    node.setAttribute('data-message-id', 'm1')
    node.getBoundingClientRect = () =>
      ({ top: 200, bottom: 240, left: 0, right: 300, width: 300, height: 40, x: 0, y: 200, toJSON: () => ({}) }) as DOMRect
    scroller.appendChild(node)
    document.body.appendChild(scroller)

    expect(jumpToTranscriptMessage('m1')).toBe(true)
    expect(scroller.scrollTop).toBe(200)
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
