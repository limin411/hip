import type { ITheme } from '@xterm/xterm'

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function isDarkDom(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

/**
 * Build an xterm theme from hip design tokens so light/dark match the shell chrome.
 */
export function buildXtermTheme(dark = isDarkDom()): ITheme {
  if (dark) {
    return {
      background: cssVar('--bg-app', '#0f0f0f'),
      foreground: cssVar('--text-primary', '#f0f0f0'),
      cursor: cssVar('--text-primary', '#f0f0f0'),
      cursorAccent: cssVar('--bg-app', '#0f0f0f'),
      selectionBackground: 'rgba(168, 184, 154, 0.35)',
      selectionForeground: cssVar('--text-primary', '#f0f0f0'),
      black: '#1a1a1a',
      red: cssVar('--danger', '#ff5252'),
      green: cssVar('--success', '#4caf50'),
      yellow: cssVar('--warning', '#ffb74d'),
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
    background: cssVar('--bg-app', '#ffffff'),
    foreground: cssVar('--text-primary', '#111111'),
    cursor: cssVar('--text-primary', '#111111'),
    cursorAccent: cssVar('--bg-app', '#ffffff'),
    selectionBackground: 'rgba(107, 124, 92, 0.28)',
    selectionForeground: cssVar('--text-primary', '#111111'),
    black: '#111111',
    red: cssVar('--danger', '#c63b3b'),
    green: cssVar('--success', '#2f7d40'),
    yellow: cssVar('--warning', '#9a5d10'),
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
