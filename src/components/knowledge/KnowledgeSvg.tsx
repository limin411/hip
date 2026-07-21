import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { sanitizeSvg } from '@/domain/knowledge/sanitizeSvg'

export interface KnowledgeSvgProps {
  /** Raw SVG source from a ```svg fence body. */
  code: string
  className?: string
}

/**
 * Knowledge-only SVG renderer for Live NodeView and Reader fences.
 * Never injects raw untrusted markup — only sanitizeSvg rebuild output.
 */
export function KnowledgeSvg({ code, className }: KnowledgeSvgProps) {
  const { t } = useTranslation()
  const result = useMemo(() => sanitizeSvg(code), [code])

  if (!result.ok) {
    let message: string
    switch (result.reason) {
      case 'empty':
        message = t('knowledge.svg.empty')
        break
      case 'too_large':
        message = t('knowledge.svg.tooLarge')
        break
      case 'too_many_nodes':
        message = t('knowledge.svg.tooManyNodes')
        break
      case 'parse':
        message = t('knowledge.svg.parseError')
        break
      case 'rejected':
      default:
        message = t('knowledge.svg.rejected')
        break
    }
    return (
      <div
        className={cn(
          'my-2 rounded-md border border-danger/40 bg-danger/5 p-2',
          className,
        )}
        data-testid="knowledge-svg-error"
        data-reason={result.reason}
      >
        <p className="mb-1 text-meta text-danger">{message}</p>
        <details className="text-meta text-ink-secondary">
          <summary className="cursor-pointer select-none">
            {t('knowledge.svg.showSource')}
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto font-mono text-meta text-ink-secondary">
            {code}
          </pre>
        </details>
      </div>
    )
  }

  return (
    <div
      className={cn('my-2 overflow-x-auto [&_svg]:max-w-full', className)}
      data-testid="knowledge-svg"
      // Only rebuilt allowlisted markup from sanitizeSvg
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  )
}
