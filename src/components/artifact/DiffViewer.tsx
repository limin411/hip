import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

type DiffLineType = 'add' | 'del' | 'ctx'

interface DiffLine {
  type: DiffLineType
  content: string
  oldNo: number | null
  newNo: number | null
}

interface DiffFile {
  path: string
  additions: number
  deletions: number
  lines: DiffLine[]
}

function lineStyle(type: DiffLineType): string {
  if (type === 'add') return 'bg-success/10'
  if (type === 'del') return 'bg-danger/10'
  return ''
}

function sign(type: DiffLineType): string {
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
  const { t } = useTranslation()
  // TODO: wire to real agent-generated diffs once coder tools are enabled
  const files: DiffFile[] = []

  if (files.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-ink-tertiary">
        <span className="text-[24px] opacity-40">±</span>
        <div className="text-[13px]">{t('artifact.noDiff')}</div>
        <div className="max-w-[200px] text-center text-[12px] opacity-70">
          {t('artifact.noDiffDesc')}
        </div>
      </div>
    )
  }

  return (
    <div>
      {files.map((file) => (
        <FileDiff key={file.path} file={file} />
      ))}
    </div>
  )
}
