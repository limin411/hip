/**
 * Code-block color preference (General Settings → code block color).
 * Shared by CodeBlock, file preview, and the knowledge Live NodeView.
 *
 * Persisted via hip.toml `[code_block].color_theme` (CodeBlockConfig).
 * `follow` keeps the legacy behavior: GitHub Light/Dark tracks document dark.
 */
import {
  CODE_BLOCK_COLOR_THEME_IDS,
  isCodeBlockColorThemeId,
  type CodeBlockColorThemeId,
} from '@hip/protocol'

export type CodeBlockThemeId = CodeBlockColorThemeId

export { CODE_BLOCK_COLOR_THEME_IDS as CODE_BLOCK_THEME_IDS }

/** Normalize raw config / persisted values; unknown or missing → `follow`. */
export function normalizeCodeBlockThemeId(
  raw: string | undefined | null,
): CodeBlockThemeId {
  if (!raw) return 'follow'
  const id = raw.trim().toLowerCase()
  return isCodeBlockColorThemeId(id) ? id : 'follow'
}

/** Map a user preference to the Shiki theme actually loaded. */
export function resolveShikiTheme(
  themeId: CodeBlockThemeId,
  isDark: boolean,
): 'github-light' | 'github-dark' {
  switch (themeId) {
    case 'light':
      return 'github-light'
    case 'dark':
      return 'github-dark'
    default:
      return isDark ? 'github-dark' : 'github-light'
  }
}

/**
 * Fixed chrome palettes for forced light/dark code blocks.
 * Values match GitHub Light/Dark so syntax tokens stay readable even when the
 * app theme is the opposite. `follow` keeps app design tokens (no palette here).
 * `paper` (T7): Notion-style warm paper surface — the doc-domain default in
 * light theme (warm gray, no border, warm text).
 */
export const CODE_BLOCK_CHROME = {
  light: {
    background: '#ffffff',
    border: '#d0d7de',
    headerBackground: '#f6f8fa',
    text: '#1f2328',
    headerText: '#57606a',
    /** GitHub Light diff 主色（色条/描边/word diff 用，跟随代码块主题）。 */
    diffAdd: '#1a7f37',
    diffDel: '#cf222e',
  },
  dark: {
    background: '#0d1117',
    border: '#30363d',
    headerBackground: '#161b22',
    text: '#e6edf3',
    headerText: '#8b949e',
    diffAdd: '#238636',
    diffDel: '#f85149',
  },
  paper: {
    background: '#f7f6f3',
    border: 'transparent',
    headerBackground: '#f0efec',
    text: '#2f2c28',
    headerText: '#6f6a63',
    diffAdd: '#1a7f37',
    diffDel: '#cf222e',
  },
} as const

export type CodeBlockChromePalette = (typeof CODE_BLOCK_CHROME)[keyof typeof CODE_BLOCK_CHROME]
