/**
 * Map a file path extension → Shiki language id for code preview.
 * Returns null when we have no grammar (caller falls back to plain text).
 */
import { normalizeHighlightLang } from '@/domain/knowledge/codeHighlight'

/** Extension (with leading dot, lowercased) → fence/lang tag. */
const EXT_TO_LANG: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.pyi': 'python',
  '.pyw': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'bash',
  '.json': 'json',
  '.jsonc': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'markdown',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.htm': 'html',
  '.xhtml': 'html',
  '.sql': 'sql',
  '.toml': 'toml',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.hh': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.dockerfile': 'dockerfile',
  '.xml': 'xml',
  '.plist': 'xml',
  '.diff': 'diff',
  '.patch': 'diff',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini',
  '.properties': 'ini',
}

/** Basename (lowercased) → lang for extension-less names. */
const BASENAME_TO_LANG: Readonly<Record<string, string>> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'bash',
  gnumakefile: 'bash',
}

function pathExt(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot).toLowerCase()
}

function pathBasename(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path
  return base.toLowerCase()
}

/**
 * Canonical highlight language for a workspace path, or null if unsupported.
 * Does not throw.
 */
export function highlightLangFromPath(path: string): string | null {
  const ext = pathExt(path)
  const fromExt = ext ? EXT_TO_LANG[ext] : undefined
  if (fromExt) return normalizeHighlightLang(fromExt)
  const fromBase = BASENAME_TO_LANG[pathBasename(path)]
  if (fromBase) return normalizeHighlightLang(fromBase)
  // Last resort: bare extension without dot (e.g. fence-style "ts") via alias table.
  if (ext) return normalizeHighlightLang(ext.slice(1))
  return null
}

/** True when this path should use the highlighted code preview (not json/csv/md/html). */
export function isHighlightableCodePath(path: string): boolean {
  return highlightLangFromPath(path) != null
}
