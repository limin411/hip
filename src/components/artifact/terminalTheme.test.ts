// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { buildXtermTheme, isDarkDom } from './terminalTheme'

describe('terminalTheme', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
  })

  it('isDarkDom follows documentElement.dark class', () => {
    expect(isDarkDom()).toBe(false)
    document.documentElement.classList.add('dark')
    expect(isDarkDom()).toBe(true)
  })

  it('light theme uses light fallbacks when CSS vars empty', () => {
    const t = buildXtermTheme(false)
    expect(t.background).toBeTruthy()
    expect(t.foreground).toBeTruthy()
    expect(t.cursor).toBeTruthy()
  })

  it('dark theme differs from light background', () => {
    const light = buildXtermTheme(false)
    const dark = buildXtermTheme(true)
    expect(dark.background).not.toBe(light.background)
    expect(dark.foreground).not.toBe(light.foreground)
  })
})
