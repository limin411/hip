/**
 * CSP-safe Shiki highlighter for knowledge code blocks.
 *
 * - Fine-grained: `shiki/core` + `shiki/engine/javascript` only
 * - NEVER import full `shiki` browser entry or oniguruma WASM
 * - Languages / themes are dynamic imports (chunk-split via @shikijs/*)
 * - Input must be plain fence text only (never HTML)
 */

import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { normalizeHighlightLang } from '@/domain/knowledge/codeHighlight'

type LangLoader = () => Promise<{ default: Parameters<HighlighterCore['loadLanguage']>[0] }>

/** Dynamic grammar loaders keyed by canonical allowlist id. */
const LANG_LOADERS: Record<string, LangLoader> = {
  typescript: () => import('@shikijs/langs/typescript'),
  javascript: () => import('@shikijs/langs/javascript'),
  tsx: () => import('@shikijs/langs/tsx'),
  jsx: () => import('@shikijs/langs/jsx'),
  python: () => import('@shikijs/langs/python'),
  rust: () => import('@shikijs/langs/rust'),
  go: () => import('@shikijs/langs/go'),
  bash: () => import('@shikijs/langs/bash'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  json: () => import('@shikijs/langs/json'),
  yaml: () => import('@shikijs/langs/yaml'),
  markdown: () => import('@shikijs/langs/markdown'),
  css: () => import('@shikijs/langs/css'),
  html: () => import('@shikijs/langs/html'),
  sql: () => import('@shikijs/langs/sql'),
  toml: () => import('@shikijs/langs/toml'),
  java: () => import('@shikijs/langs/java'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  ruby: () => import('@shikijs/langs/ruby'),
  php: () => import('@shikijs/langs/php'),
  swift: () => import('@shikijs/langs/swift'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  xml: () => import('@shikijs/langs/xml'),
  diff: () => import('@shikijs/langs/diff'),
  graphql: () => import('@shikijs/langs/graphql'),
  scss: () => import('@shikijs/langs/scss'),
  less: () => import('@shikijs/langs/less'),
  ini: () => import('@shikijs/langs/ini'),
}

const THEME_LIGHT = 'github-light'
const THEME_DARK = 'github-dark'

let highlighterPromise: Promise<HighlighterCore> | null = null
const loadedLangs = new Set<string>()

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      // Themes loaded once; langs loaded on demand via loadLanguage.
      themes: [
        import('@shikijs/themes/github-light'),
        import('@shikijs/themes/github-dark'),
      ],
      langs: [],
      // CSP: JS RegExp engine only — no oniguruma WASM.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    }).catch((err) => {
      highlighterPromise = null
      throw err
    })
  }
  return highlighterPromise
}

async function ensureLang(hl: HighlighterCore, lang: string): Promise<boolean> {
  if (loadedLangs.has(lang)) return true
  const loader = LANG_LOADERS[lang]
  if (!loader) return false
  try {
    const mod = await loader()
    await hl.loadLanguage(mod.default)
    loadedLangs.add(lang)
    return true
  } catch {
    return false
  }
}

/**
 * Highlight plain fence text → HTML span tokens (no outer `<pre>`).
 * Returns null on unknown lang / empty / failure (caller shows plain text).
 */
export async function highlightCode(
  code: string,
  lang: string | undefined | null,
  isDark: boolean,
): Promise<string | null> {
  if (!code) return null
  const canonical = normalizeHighlightLang(lang)
  if (!canonical) return null

  try {
    const hl = await getHighlighter()
    const ok = await ensureLang(hl, canonical)
    if (!ok) return null

    const theme = isDark ? THEME_DARK : THEME_LIGHT
    // structure: 'inline' → token spans only (no nested shiki <pre>/<code>)
    return hl.codeToHtml(code, {
      lang: canonical,
      theme,
      structure: 'inline',
    })
  } catch {
    return null
  }
}

/** Test helper — reset singleton between tests. */
export function __resetShikiLazyForTests(): void {
  highlighterPromise = null
  loadedLangs.clear()
}
