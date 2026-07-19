import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export interface KnowledgeMermaidProps {
  code: string
  className?: string
}

/**
 * Lazy mermaid renderer for knowledge Preview (not chat).
 * Failures show source + error line.
 */
export function KnowledgeMermaid({ code, className }: KnowledgeMermaidProps) {
  const { t } = useTranslation()
  const reactId = useId().replace(/:/g, '')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setError(null)
      setSvg(null)
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'neutral',
        })
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
  }, [code, reactId])

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
