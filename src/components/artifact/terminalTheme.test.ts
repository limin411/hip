// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildXtermTheme,
  buildHipXtermTheme,
  isDarkDom,
  normalizeTerminalColorThemeId,
  resolveXtermTheme,
  TERMINAL_COLOR_THEME_IDS,
} from './terminalTheme'
import type { ITheme } from '@xterm/xterm'

const ANSI_KEYS: (keyof ITheme)[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
]

function assertPalette(theme: ITheme) {
  expect(theme.background).toBeTruthy()
  expect(theme.foreground).toBeTruthy()
  expect(theme.background).not.toBe(theme.foreground)
  for (const k of ANSI_KEYS) {
    expect(theme[k], String(k)).toBeTruthy()
  }
}

describe('terminalTheme', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
    // Clear inline token overrides so tests that inject --bg-app / --text-primary
    // cannot leak into later follow-mode or empty-var cases.
    document.documentElement.style.removeProperty('--bg-app')
    document.documentElement.style.removeProperty('--text-primary')
    document.documentElement.style.removeProperty('--danger')
    document.documentElement.style.removeProperty('--success')
    document.documentElement.style.removeProperty('--warning')
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

  it('normalizeTerminalColorThemeId falls back to follow', () => {
    expect(normalizeTerminalColorThemeId(undefined)).toBe('follow')
    expect(normalizeTerminalColorThemeId(null)).toBe('follow')
    expect(normalizeTerminalColorThemeId('')).toBe('follow')
    expect(normalizeTerminalColorThemeId('not-a-theme')).toBe('follow')
    expect(normalizeTerminalColorThemeId('Dracula')).toBe('dracula')
  })

  it('resolveXtermTheme follow tracks darkDom', () => {
    const light = resolveXtermTheme('follow', false)
    const dark = resolveXtermTheme('follow', true)
    expect(dark.background).not.toBe(light.background)
  })

  it('resolveXtermTheme light/dark ignore darkDom', () => {
    const lightOnDark = resolveXtermTheme('light', true)
    const lightOnLight = resolveXtermTheme('light', false)
    expect(lightOnDark.background).toBe(lightOnLight.background)

    const darkOnLight = resolveXtermTheme('dark', false)
    const darkOnDark = resolveXtermTheme('dark', true)
    expect(darkOnLight.background).toBe(darkOnDark.background)
    expect(darkOnLight.background).not.toBe(lightOnLight.background)
  })

  it('forced dark uses fixed dark palette even when DOM is light (app CSS vars light)', () => {
    // Simulate light app chrome tokens on :root (bug: previously cssVar overrode dark branch).
    document.documentElement.classList.remove('dark')
    document.documentElement.style.setProperty('--bg-app', '#ffffff')
    document.documentElement.style.setProperty('--text-primary', '#111111')

    const dark = resolveXtermTheme('dark', false)
    expect(dark.background).toBe('#0f0f0f')
    expect(dark.foreground).toBe('#f0f0f0')
    expect(dark.background).not.toBe('#ffffff')

    const light = resolveXtermTheme('light', true)
    expect(light.background).toBe('#ffffff')
    expect(light.foreground).toBe('#111111')

    // follow still tracks live DOM tokens
    const follow = resolveXtermTheme('follow', false)
    expect(follow.background).toBe('#ffffff')
  })

  it('named presets match Appendix A anchors and pass contrast smoke', () => {
    const solarized = resolveXtermTheme('solarized-dark')
    expect(solarized.background).toBe('#002b36')
    expect(solarized.foreground).toBe('#839496')

    const dracula = resolveXtermTheme('dracula')
    expect(dracula.background).toBe('#282a36')
    expect(dracula.foreground).toBe('#f8f8f2')

    const oneDark = resolveXtermTheme('one-dark')
    expect(oneDark.background).toBe('#282c34')

    for (const id of TERMINAL_COLOR_THEME_IDS) {
      assertPalette(resolveXtermTheme(id, false))
      assertPalette(resolveXtermTheme(id, true))
    }
  })

  it('buildHipXtermTheme matches buildXtermTheme', () => {
    expect(buildHipXtermTheme(false)).toEqual(buildXtermTheme(false))
    expect(buildHipXtermTheme(true)).toEqual(buildXtermTheme(true))
  })
})
