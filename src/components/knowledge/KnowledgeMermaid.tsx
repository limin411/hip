import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isDocDark, subscribeDocTheme } from '@/lib/docTheme'
import { cn } from '@/lib/utils'

export interface KnowledgeMermaidProps {
  code: string
  className?: string
}

type MermaidApi = typeof import('mermaid').default
type MermaidTheme = 'dark' | 'neutral'

let mermaidLoad: Promise<MermaidApi> | null = null
/** Theme last applied via mermaid.initialize (module-level; not every render). */
let appliedTheme: MermaidTheme | null = null

async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidLoad) {
    mermaidLoad = import('mermaid').then((m) => m.default)
  }
  return mermaidLoad
}

/**
 * Ensure mermaid is initialized for the given theme.
 * Calls `initialize` only on first use and when the theme actually changes.
 */
async function ensureMermaid(theme: MermaidTheme): Promise<MermaidApi> {
  const mermaid = await loadMermaid()
  if (appliedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme,
    })
    appliedTheme = theme
  }
  return mermaid
}

/** Shared `subscribeDocTheme` observer (one MutationObserver for mermaid + Shiki). */
function useDocDark(): boolean {
  const [dark, setDark] = useState(isDocDark)

  useEffect(() => {
    const sync = () => setDark(isDocDark())
    sync()
    return subscribeDocTheme(sync)
  }, [])

  return dark
}

/**
 * Lazy mermaid renderer for knowledge Live / Reader (not chat).
 * Failures show source + error line.
 */
export function KnowledgeMermaid({ code, className }: KnowledgeMermaidProps) {
  const { t } = useTranslation()
  const reactId = useId().replace(/:/g, '')
  const dark = useDocDark()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setError(null)
      setSvg(null)
      try {
        const theme = dark ? 'dark' : 'neutral'
        const mermaid = await ensureMermaid(theme)
        const id = `hip-mmd-${reactId}-${Math.random().toString(36).slice(2, 8)}`
        const { svg: out } = await mermaid.render(id, code.trim())
        if (!cancelled) setSvg(out)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [code, reactId, dark])

  if (error) {
    return (
      <div
        className={cn('my-2 rounded-md border border-danger/40 bg-danger/5 p-2', className)}
        data-testid="knowledge-mermaid-error"
      >
        <p className="mb-1 text-meta text-danger">{error}</p>
        <pre className="overflow-x-auto font-mono text-meta text-ink-secondary">{code}</pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div
        className={cn('my-2 text-meta text-ink-tertiary', className)}
        data-testid="knowledge-mermaid-loading"
      >
        {t('knowledge.mermaid.loading')}
      </div>
    )
  }

  return (
    <div
      className={cn('my-2 overflow-x-auto [&_svg]:max-w-full', className)}
      data-testid="knowledge-mermaid"
      // mermaid returns sanitized SVG string under securityLevel strict
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/** Test helper: which theme mermaid was last initialized with (null if never). */
export function __mermaidAppliedThemeForTests(): MermaidTheme | null {
  return appliedTheme
}

/** Test helper: reset module-level mermaid load/init state. */
export function __resetMermaidModuleForTests(): void {
  mermaidLoad = null
  appliedTheme = null
}
