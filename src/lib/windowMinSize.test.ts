import { describe, it, expect } from 'vitest'
import conf from '../../src-tauri/tauri.conf.json'
import { WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH } from './windowMinSize'

describe('windowMinSize', () => {
  it('matches tauri.conf.json main window min size', () => {
    const win = conf.app.windows[0]
    expect(win.minWidth).toBe(WINDOW_MIN_WIDTH)
    expect(win.minHeight).toBe(WINDOW_MIN_HEIGHT)
  })
})
