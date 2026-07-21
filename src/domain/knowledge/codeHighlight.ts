/**
 * Knowledge code-highlight language allowlist + aliases (pure domain).
 * Consumers (shikiLazy, CodeBlock, Live NodeView) normalize fence info strings
 * through here before requesting a Shiki grammar.
 */

/** Canonical Shiki language ids we ship (lazy-loaded one-by-one). */
export const KNOWLEDGE_HIGHLIGHT_LANGS = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'python',
  'rust',
  'go',
  'bash',
  'shellscript',
  'json',
  'yaml',
  'markdown',
  'css',
  'html',
  'sql',
  'toml',
  'java',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'dockerfile',
  'xml',
  'diff',
  'graphql',
  'scss',
  'less',
  'ini',
] as const

export type KnowledgeHighlightLang = (typeof KNOWLEDGE_HIGHLIGHT_LANGS)[number]

const LANG_SET: ReadonlySet<string> = new Set(KNOWLEDGE_HIGHLIGHT_LANGS)

/**
 * Map common fence tags / short names → canonical allowlist id.
 * Keys are lowercased.
 */
export const HIGHLIGHT_LANG_ALIASES: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  python3: 'python',
  rs: 'rust',
  golang: 'go',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  bash: 'bash',
  shellscript: 'shellscript',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  htm: 'html',
  xhtml: 'html',
  cs: 'csharp',
  'c#': 'csharp',
  'c++': 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  rb: 'ruby',
  kt: 'kotlin',
  // intentionally no `text` → markdown (plain ```text fences stay unhighlighted)
}

/**
 * Normalize a fence language tag to a supported Shiki id, or null if unknown
 * / empty / not on the allowlist. Never throws.
 */
export function normalizeHighlightLang(
  lang: string | undefined | null,
): string | null {
  if (lang == null) return null
  const raw = lang.trim().toLowerCase()
  if (!raw) return null
  const canonical = HIGHLIGHT_LANG_ALIASES[raw] ?? raw
  if (LANG_SET.has(canonical)) return canonical
  return null
}
