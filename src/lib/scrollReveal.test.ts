// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installScrollReveal } from './scrollReveal'

describe('installScrollReveal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('adds is-scrolling on scroll and clears after idle', () => {
    const dispose = installScrollReveal()
    const el = document.createElement('div')
    document.body.appendChild(el)

    el.dispatchEvent(new Event('scroll', { bubbles: false }))
    expect(el.classList.contains('is-scrolling')).toBe(true)

    vi.advanceTimersByTime(900)
    expect(el.classList.contains('is-scrolling')).toBe(false)

    dispose()
    el.remove()
  })
})
