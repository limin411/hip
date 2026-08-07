/**
 * BlockNote Live code-block Shiki wiring (CSP-safe).
 *
 * BN's default codeBlock has no highlighter unless createCodeBlockSpec is given
 * a createHighlighter. We reuse the same github-light/dark themes + language
 * allowlist as Reader (`shikiLazy`) so Live and Reader look consistent.
 *
 * Theme caveat (BN 0.52 / prosemirror-highlight): createParser always picks
 * highlighter.getLoadedThemes()[0]. We wrap the core highlighter so both
 * getLoadedThemes()[0] and codeToTokens use the currently resolved theme.
 * DocBlockNoteEditor dispatches `prosemirror-highlight-refresh` on theme change.
 */
import { createCodeBlockSpec } from '@blocknote/core'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import {
  HIGHLIGHT_LANG_ALIASES,
  KNOWLEDGE_HIGHLIGHT_LANGS,
} from '../codeHighlight'
import {
  normalizeCodeBlockThemeId,
  resolveShikiTheme,
  type CodeBlockThemeId,
} from '../codeBlockTheme'
import { isDocDark } from '@/lib/docTheme'

type ShikiThemeName = 'github-light' | 'github-dark'

let corePromise: Promise<HighlighterCore> | null = null
let themePref: CodeBlockThemeId = 'follow'

/** Keep in sync with General Settings → code block color (host sets this). */
export function setLiveCodeBlockThemePref(pref: CodeBlockThemeId): void {
  themePref = normalizeCodeBlockThemeId(pref)
}

export function resolveLiveCodeShikiTheme(): ShikiThemeName {
  return resolveShikiTheme(themePref, isDocDark())
}

async function getCoreHighlighter(): Promise<HighlighterCore> {
  if (!corePromise) {
    corePromise = createHighlighterCore({
      themes: [
        import('@shikijs/themes/github-light'),
        import('@shikijs/themes/github-dark'),
      ],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    }).catch((err) => {
      corePromise = null
      throw err
    })
  }
  return corePromise
}

/** Display names for the language picker (id → label). */
function buildSupportedLanguages(): Record<
  string,
  { name: string; aliases?: string[] }
> {
  const aliasBuckets = new Map<string, string[]>()
  for (const [alias, canonical] of Object.entries(HIGHLIGHT_LANG_ALIASES)) {
    if (alias === canonical) continue
    const list = aliasBuckets.get(canonical) ?? []
    list.push(alias)
    aliasBuckets.set(canonical, list)
  }

  const out: Record<string, { name: string; aliases?: string[] }> = {
    text: { name: 'Plain Text', aliases: ['plaintext', 'txt', ''] },
  }
  for (const id of KNOWLEDGE_HIGHLIGHT_LANGS) {
    const aliases = aliasBuckets.get(id)
    out[id] = {
      name: id,
      ...(aliases && aliases.length > 0 ? { aliases } : {}),
    }
  }
  return out
}

/**
 * BN createHighlighter factory — returns a theme-aware proxy over shiki core.
 */
export async function createLiveCodeHighlighter(): Promise<HighlighterCore> {
  const core = await getCoreHighlighter()

  // Proxy so BN's createParser (which uses getLoadedThemes()[0] + codeToTokens)
  // always hits the resolved Live theme.
  const proxy = new Proxy(core, {
    get(target, prop, receiver) {
      if (prop === 'getLoadedThemes') {
        return () => [resolveLiveCodeShikiTheme()]
      }
      if (prop === 'codeToTokens') {
        return (code: string, options: { lang?: string; theme?: string } & Record<string, unknown>) => {
          const theme = resolveLiveCodeShikiTheme()
          return target.codeToTokens(code, {
            ...options,
            theme,
            lang: options.lang ?? 'text',
          })
        }
      }
      if (prop === 'getLoadedLanguages') {
        return () => target.getLoadedLanguages()
      }
      if (prop === 'loadLanguage') {
        return (lang: Parameters<HighlighterCore['loadLanguage']>[0]) =>
          target.loadLanguage(lang)
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  return proxy as HighlighterCore
}

/** Knowledge schema codeBlock with highlighter + language picker. */
export function createKnowledgeCodeBlockSpec() {
  return createCodeBlockSpec({
    indentLineWithTab: true,
    defaultLanguage: 'text',
    supportedLanguages: buildSupportedLanguages(),
    createHighlighter: () => createLiveCodeHighlighter() as Promise<never>,
  })
}

/** Test helper. */
export function __resetLiveCodeHighlighterForTests(): void {
  corePromise = null
  themePref = 'follow'
}
