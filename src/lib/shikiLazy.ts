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
import {
  normalizeCodeBlockThemeId,
  resolveShikiTheme,
  type CodeBlockThemeId,
} from '@/domain/knowledge/codeBlockTheme'
import {
  isKnowledgePerfEnabled,
  kbPerfShiki,
} from '@/domain/knowledge/knowledgePerf'

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

let highlighterPromise: Promise<HighlighterCore> | null = null
const loadedLangs = new Set<string>()

/** Bounded highlight cache (lang|theme|code → HTML). Cap avoids unbounded growth.
 * Craft upgrade PR-6: LRU max 32 retained highlights. */
const HIGHLIGHT_CACHE_MAX = 32
const highlightCache = new Map<string, string>()

/** Concurrent highlight cap (craft PR-6). */
const HIGHLIGHT_CONCURRENCY = 3
let highlightInFlight = 0
const highlightWaitQueue: Array<() => void> = []

async function withHighlightSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (highlightInFlight >= HIGHLIGHT_CONCURRENCY) {
    await new Promise<void>((resolve) => {
      highlightWaitQueue.push(resolve)
    })
  }
  highlightInFlight += 1
  try {
    return await fn()
  } finally {
    highlightInFlight -= 1
    const next = highlightWaitQueue.shift()
    next?.()
  }
}

function cacheKey(lang: string, theme: string, code: string): string {
  // Avoid huge keys for multi-MB fences — hash-ish length prefix + length.
  if (code.length > 4000) {
    return `${lang}|${theme}|L${code.length}|${code.slice(0, 200)}|${code.slice(-200)}`
  }
  return `${lang}|${theme}|${code}`
}

function cacheGet(key: string): string | undefined {
  const hit = highlightCache.get(key)
  if (hit === undefined) return undefined
  // LRU: re-insert at end
  highlightCache.delete(key)
  highlightCache.set(key, hit)
  return hit
}

function cacheSet(key: string, html: string): void {
  if (highlightCache.has(key)) highlightCache.delete(key)
  highlightCache.set(key, html)
  while (highlightCache.size > HIGHLIGHT_CACHE_MAX) {
    const oldest = highlightCache.keys().next().value
    if (oldest === undefined) break
    highlightCache.delete(oldest)
  }
}

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
  themeId: CodeBlockThemeId,
  isDark: boolean,
): Promise<string | null> {
  if (!code) return null
  // Skip very large fences (UTF-16 code units) — craft PR-6.
  if (code.length > 50_000) return null
  const canonical = normalizeHighlightLang(lang)
  if (!canonical) return null

  const theme = resolveShikiTheme(normalizeCodeBlockThemeId(themeId), isDark)
  const key = cacheKey(canonical, theme, code)
  const cached = cacheGet(key)
  if (cached !== undefined) {
    if (isKnowledgePerfEnabled()) kbPerfShiki(0)
    return cached
  }

  return withHighlightSlot(async () => {
    const t0 = isKnowledgePerfEnabled() ? performance.now() : 0
    try {
      const hl = await getHighlighter()
      const ok = await ensureLang(hl, canonical)
      if (!ok) return null

      // structure: 'inline' → token spans only (no nested shiki <pre>/<code>)
      const html = hl.codeToHtml(code, {
        lang: canonical,
        theme,
        structure: 'inline',
      })
      cacheSet(key, html)
      if (isKnowledgePerfEnabled()) kbPerfShiki(performance.now() - t0)
      return html
    } catch {
      return null
    }
  })
}

/** Test helper — reset singleton between tests. */
export function __resetShikiLazyForTests(): void {
  highlighterPromise = null
  loadedLangs.clear()
  highlightCache.clear()
}
