import type { DiffLine } from '@/domain/knowledge/textDiff'
import { cn } from '@/lib/utils'

export interface VersionDiffViewProps {
  lines: DiffLine[]
  className?: string
}

export function VersionDiffView({ lines, className }: VersionDiffViewProps) {
  return (
    <div
      className={cn('max-h-[60vh] overflow-auto font-mono text-meta', className)}
      data-testid="knowledge-version-diff-body"
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            'flex whitespace-pre-wrap px-3 py-0.5',
            line.type === 'add' && 'bg-success/10 text-success',
            line.type === 'del' && 'bg-danger/10 text-danger',
            line.type === 'same' && 'text-ink-secondary',
          )}
          data-diff-type={line.type}
        >
          <span className="w-10 shrink-0 select-none text-right opacity-50">
            {line.oldNo ?? ''}
          </span>
          <span className="w-10 shrink-0 select-none text-right opacity-50">
            {line.newNo ?? ''}
          </span>
          <span className="w-4 shrink-0 select-none">
            {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
          </span>
          <span className="min-w-0 flex-1 break-all">{line.text}</span>
        </div>
      ))}
    </div>
  )
}
