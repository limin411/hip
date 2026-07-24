import type { ITheme } from '@xterm/xterm'
import {
  type TerminalColorThemeId,
  TERMINAL_COLOR_THEME_IDS,
  isTerminalColorThemeId,
} from '@hip/protocol'

export { TERMINAL_COLOR_THEME_IDS, type TerminalColorThemeId }

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/**
 * Resolve a token for hip palettes.
 * - `useDomTokens: true` (follow): read live CSS vars so terminal tracks chrome tokens.
 * - `useDomTokens: false` (forced light/dark): use fixed fallbacks so app light/dark does not
 *   clobber an independent terminal preference (e.g. dark terminal on light app).
 */
function hipToken(name: string, fallback: string, useDomTokens: boolean): string {
  return useDomTokens ? cssVar(name, fallback) : fallback
}

export function isDarkDom(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

export function normalizeTerminalColorThemeId(
  raw: string | undefined | null,
): TerminalColorThemeId {
  if (!raw) return 'follow'
  const id = raw.trim().toLowerCase()
  return isTerminalColorThemeId(id) ? id : 'follow'
}

export type BuildHipXtermThemeOptions = {
  /**
   * When true, read `--bg-app` / `--text-primary` etc. from the document (for `follow`).
   * When false, use fixed hip light/dark hex fallbacks (for forced `light` / `dark`).
   * Default true for back-compat with buildXtermTheme / follow.
   */
  useDomTokens?: boolean
}

/**
 * Hip token-derived light/dark palettes so chrome-aligned terminals match design tokens.
 */
export function buildHipXtermTheme(
  dark = isDarkDom(),
  opts?: BuildHipXtermThemeOptions,
): ITheme {
  const useDomTokens = opts?.useDomTokens ?? true
  if (dark) {
    return {
      background: hipToken('--bg-app', '#0f0f0f', useDomTokens),
      foreground: hipToken('--text-primary', '#f0f0f0', useDomTokens),
      cursor: hipToken('--text-primary', '#f0f0f0', useDomTokens),
      cursorAccent: hipToken('--bg-app', '#0f0f0f', useDomTokens),
      selectionBackground: 'rgba(168, 184, 154, 0.35)',
      selectionForeground: hipToken('--text-primary', '#f0f0f0', useDomTokens),
      black: '#1a1a1a',
      red: hipToken('--danger', '#ff5252', useDomTokens),
      green: hipToken('--success', '#4caf50', useDomTokens),
      yellow: hipToken('--warning', '#ffb74d', useDomTokens),
      blue: '#4db8ff',
      magenta: '#7c7cf0',
      cyan: '#2ee6e6',
      white: '#e8e8e8',
      brightBlack: '#666666',
      brightRed: '#ff7a7a',
      brightGreen: '#7dca80',
      brightYellow: '#ffcc80',
      brightBlue: '#80d0ff',
      brightMagenta: '#a0a0ff',
      brightCyan: '#6ef0f0',
      brightWhite: '#ffffff',
    }
  }
  return {
    background: hipToken('--bg-app', '#ffffff', useDomTokens),
    foreground: hipToken('--text-primary', '#111111', useDomTokens),
    cursor: hipToken('--text-primary', '#111111', useDomTokens),
    cursorAccent: hipToken('--bg-app', '#ffffff', useDomTokens),
    selectionBackground: 'rgba(107, 124, 92, 0.28)',
    selectionForeground: hipToken('--text-primary', '#111111', useDomTokens),
    black: '#111111',
    red: hipToken('--danger', '#c63b3b', useDomTokens),
    green: hipToken('--success', '#2f7d40', useDomTokens),
    yellow: hipToken('--warning', '#9a5d10', useDomTokens),
    blue: '#1a8cd8',
    magenta: '#5b5bd6',
    cyan: '#0d8a8a',
    white: '#666666',
    brightBlack: '#757575',
    brightRed: '#d64545',
    brightGreen: '#3d9a50',
    brightYellow: '#c77a1a',
    brightBlue: '#4db8ff',
    brightMagenta: '#7c7cf0',
    brightCyan: '#2ee6e6',
    brightWhite: '#111111',
  }
}

/**
 * Build an xterm theme from hip design tokens so light/dark match the shell chrome.
 * @deprecated Prefer resolveXtermTheme when colorTheme pref is available.
 */
export function buildXtermTheme(dark = isDarkDom()): ITheme {
  return buildHipXtermTheme(dark, { useDomTokens: true })
}

/**
 * Named presets — hex locked to design Appendix A.
 * Source URLs in comments above each entry.
 */
const NAMED: Record<
  Exclude<TerminalColorThemeId, 'follow' | 'light' | 'dark'>,
  ITheme
> = {
  // Ethan Schoonover Solarized — https://ethanschoonover.com/solarized/
  'solarized-dark': {
    background: '#002b36',
    foreground: '#839496',
    cursor: '#839496',
    cursorAccent: '#002b36',
    selectionBackground: '#073642',
    selectionForeground: '#93a1a1',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightRed: '#cb4b16',
    brightGreen: '#859900',
    brightYellow: '#b58900',
    brightBlue: '#268bd2',
    brightMagenta: '#6c71c4',
    brightCyan: '#2aa198',
    brightWhite: '#fdf6e3',
  },
  // Ethan Schoonover Solarized — https://ethanschoonover.com/solarized/
  'solarized-light': {
    background: '#fdf6e3',
    foreground: '#657b83',
    cursor: '#657b83',
    cursorAccent: '#fdf6e3',
    selectionBackground: '#eee8d5',
    selectionForeground: '#586e75',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightRed: '#cb4b16',
    brightGreen: '#859900',
    brightYellow: '#b58900',
    brightBlue: '#268bd2',
    brightMagenta: '#6c71c4',
    brightCyan: '#2aa198',
    brightWhite: '#002b36',
  },
  // Dracula Theme Spec — https://draculatheme.com/spec
  // ANSI CSS — https://draculatheme.com/dracula-css
  dracula: {
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    cursorAccent: '#282a36',
    selectionBackground: '#44475a',
    selectionForeground: '#f8f8f2',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  },
  // Atom One Dark / common terminal ports (Ghostty-style / onedark lineage)
  'one-dark': {
    background: '#282c34',
    foreground: '#abb2bf',
    cursor: '#528bff',
    cursorAccent: '#282c34',
    selectionBackground: '#3e4451',
    selectionForeground: '#abb2bf',
    black: '#21252b',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
    brightBlack: '#5c6370',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#ffffff',
  },
}

/**
 * Resolve xterm ITheme from the user's terminal colorTheme preference.
 * - follow: match document dark class (legacy default)
 * - light / dark: hip token palettes forced
 * - named: static catalog
 */
export function resolveXtermTheme(
  pref: TerminalColorThemeId | undefined | null,
  darkDom: boolean = isDarkDom(),
): ITheme {
  const id = normalizeTerminalColorThemeId(pref ?? undefined)
  switch (id) {
    case 'follow':
      // Track app chrome tokens from the live DOM.
      return buildHipXtermTheme(darkDom, { useDomTokens: true })
    case 'light':
      // Forced hip light — never read light/dark from the current app theme.
      return buildHipXtermTheme(false, { useDomTokens: false })
    case 'dark':
      // Forced hip dark — independent of documentElement.dark / CSS vars.
      return buildHipXtermTheme(true, { useDomTokens: false })
    default:
      return NAMED[id]
  }
}
