import type { DiffFile, DiffLine } from '@/mock/types'
import { mockDiff } from '@/mock/diff'
import { cn } from '@/lib/utils'

function lineStyle(type: DiffLine['type']): string {
  if (type === 'add') return 'bg-success/10'
  if (type === 'del') return 'bg-danger/10'
  return ''
}

function sign(type: DiffLine['type']): string {
  if (type === 'add') return '+'
  if (type === 'del') return '-'
  return ' '
}

function FileDiff({ file }: { file: DiffFile }) {
  return (
    <div className="border-b border-border">
      <div className="flex items-center justify-between bg-surface-muted px-3 py-2">
        <span className="font-mono text-[12px] text-ink">{file.path}</span>
        <span className="flex items-center gap-2 text-[11px]">
          <span className="text-success">+{file.additions}</span>
          <span className="text-danger">-{file.deletions}</span>
        </span>
      </div>
      <div className="overflow-x-auto font-mono text-[12.5px] leading-relaxed">
        {file.lines.map((line, i) => (
          <div key={i} className={cn('flex', lineStyle(line.type))}>
            <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.oldNo ?? ''}</span>
            <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.newNo ?? ''}</span>
            <span
              className={cn(
                'w-4 shrink-0 select-none text-center',
                line.type === 'add' && 'text-success',
                line.type === 'del' && 'text-danger',
              )}
            >
              {sign(line.type)}
            </span>
            <span className="whitespace-pre px-1 text-ink">{line.content}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DiffViewer() {
  return (
    <div>
      {mockDiff.map((file) => (
        <FileDiff key={file.path} file={file} />
      ))}
    </div>
  )
}
