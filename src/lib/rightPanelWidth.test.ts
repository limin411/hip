// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  RIGHT_PANEL_MAIN_TARGET,
  RIGHT_PANEL_SCREEN_MIN,
  mainContentWidth,
  widenWindowForRightPanel,
} from './rightPanelWidth'

const setSize = vi.fn().mockResolvedValue(undefined)

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setSize }),
  LogicalSize: class LogicalSize {
    type: string
    constructor(public width: number, public height: number) {
      this.type = 'Logical'
    }
  },
}))

const realInnerWidth = window.innerWidth
const realInnerHeight = window.innerHeight

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true, writable: true })
  Object.defineProperty(window.screen, 'availWidth', { value: 1920, configurable: true, writable: true })
  // Simulate Tauri webview
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__TAURI_INTERNALS__ = {}
  document.body.innerHTML = ''
  setSize.mockClear()
  setSize.mockResolvedValue(undefined)
})

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: realInnerWidth, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: realInnerHeight, configurable: true, writable: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__TAURI_INTERNALS__
  document.body.innerHTML = ''
})

describe('mainContentWidth', () => {
  it('subtracts the left sidebar when it is open (no DOM host)', () => {
    expect(mainContentWidth(true, 300)).toBe(1300)
    expect(mainContentWidth(false, 300)).toBe(1600)
  })

  it('prefers the live DOM measure when [data-main-content-group] is present', () => {
    const el = document.createElement('div')
    el.setAttribute('data-main-content-group', '')
    Object.defineProperty(el, 'clientWidth', { value: 1111 })
    document.body.appendChild(el)
    expect(mainContentWidth(true, 300)).toBe(1111)
  })
})

describe('widenWindowForRightPanel', () => {
  it('resizes the window so the main content reaches the target when too narrow', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true, writable: true })
    const widened = await widenWindowForRightPanel(true, 300)
    expect(widened).toBe(true)
    expect(setSize).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Logical', width: RIGHT_PANEL_MAIN_TARGET + 300, height: 900 }),
    )
  })

  it('is a no-op when the main content area is already wide enough', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 2000, configurable: true, writable: true })
    const widened = await widenWindowForRightPanel(true, 300)
    expect(widened).toBe(false)
    expect(setSize).not.toHaveBeenCalled()
  })

  it('falls back when the screen resolution is insufficient', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true, writable: true })
    Object.defineProperty(window.screen, 'availWidth', { value: 1366, configurable: true, writable: true })
    expect(RIGHT_PANEL_SCREEN_MIN).toBe(RIGHT_PANEL_MAIN_TARGET)
    const widened = await widenWindowForRightPanel(false, 300)
    expect(widened).toBe(false)
    expect(setSize).not.toHaveBeenCalled()
  })

  it('clamps the window width to the screen so it never goes off-screen', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true, writable: true })
    Object.defineProperty(window.screen, 'availWidth', { value: 1800, configurable: true, writable: true })
    const widened = await widenWindowForRightPanel(true, 300)
    expect(widened).toBe(true)
    expect(setSize).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Logical', width: 1800, height: 900 }),
    )
  })

  it('falls back when the resize fails', async () => {
    setSize.mockRejectedValueOnce(new Error('no tauri'))
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true, writable: true })
    const widened = await widenWindowForRightPanel(false, 300)
    expect(widened).toBe(false)
  })

  it('is a no-op outside the Tauri runtime', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__TAURI_INTERNALS__
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true, writable: true })
    const widened = await widenWindowForRightPanel(false, 300)
    expect(widened).toBe(false)
    expect(setSize).not.toHaveBeenCalled()
  })
})
