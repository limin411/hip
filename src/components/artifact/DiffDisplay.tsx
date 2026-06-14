import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { DiffFile, DiffHunk, DiffLine, DiffLineType, DiffFileStatus, DiffSummary } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { computeHunkWordDiffs } from '@/lib/wordDiff'
import { buildSplitRows } from '@/lib/diffSplit'

export const STATUS_CHIP = {
  added: { cls: 'bg-success/15 text-success', key: 'artifact.diffView.statusAdded' },
  modified: { cls: 'bg-warning/15 text-warning', key: 'artifact.diffView.statusModified' },
  deleted: { cls: 'bg-danger/15 text-danger', key: 'artifact.diffView.statusDeleted' },
  renamed: { cls: 'bg-accent/15 text-accent', key: 'artifact.diffView.statusRenamed' },
} as const satisfies Record<DiffFileStatus, { cls: string; key: string }>

function lineStyle(t: DiffLineType): string { return t === 'add' ? 'bg-success/10' : t === 'del' ? 'bg-danger/10' : '' }
function sign(t: DiffLineType): string { return t === 'add' ? '+' : t === 'del' ? '-' : ' ' }

function HunkLines({ hunk, viewMode }: { hunk: DiffHunk; viewMode: 'unified' | 'split' }) {
  const { t } = useTranslation()
  if (viewMode === 'split') {
    const splitRows = buildSplitRows(hunk.lines)
    return (
      <>
        <div className="flex bg-surface-muted/60 text-caption text-ink-tertiary">
          <span className="shrink-0 select-none px-2 font-mono">@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
          {hunk.header && <span className="truncate px-1 opacity-70">{hunk.header}</span>}
        </div>
        {splitRows.map((row, i) => (
          <div key={i} className="flex">
            <div className={cn('flex flex-1 min-w-0', row.left ? lineStyle(row.left.type) : 'bg-surface-muted/30')}>
              {row.left ? (
                <>
                  <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{row.left.oldNo ?? ''}</span>
                  <span className={cn('w-4 shrink-0 select-none text-center', row.left.type === 'del' && 'text-danger')}>{sign(row.left.type)}</span>
                  <span className="whitespace-pre px-1 text-ink">{row.left.content}</span>
                </>
              ) : (<span className="w-full" />)}
            </div>
            <div className="w-px shrink-0 bg-border" />
            <div className={cn('flex flex-1 min-w-0', row.right ? lineStyle(row.right.type) : 'bg-surface-muted/30')}>
              {row.right ? (
                <>
                  <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{row.right.newNo ?? ''}</span>
                  <span className={cn('w-4 shrink-0 select-none text-center', row.right.type === 'add' && 'text-success')}>{sign(row.right.type)}</span>
                  <span className="whitespace-pre px-1 text-ink">{row.right.content}</span>
                </>
              ) : (<span className="w-full" />)}
            </div>
          </div>
        ))}
      </>
    )
  }
  const spans = computeHunkWordDiffs(hunk.lines)
  return (
    <>
      <div className="flex bg-surface-muted/60 text-caption text-ink-tertiary">
        <span className="shrink-0 select-none px-2 font-mono">@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
        {hunk.header && <span className="truncate px-1 opacity-70">{hunk.header}</span>}
      </div>
      {hunk.lines.map((line: DiffLine, i) => (
        <div key={i} className={cn('flex', lineStyle(line.type))}>
          <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.oldNo ?? ''}</span>
          <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.newNo ?? ''}</span>
          <span className={cn('w-4 shrink-0 select-none text-center', line.type === 'add' && 'text-success', line.type === 'del' && 'text-danger')}>{sign(line.type)}</span>
          {spans[i]
            ? <span className="whitespace-pre px-1 text-ink">{spans[i]!.map((sp, k) => <span key={k} className={cn(sp.changed && (line.type === 'add' ? 'bg-success/30' : 'bg-danger/30'))}>{sp.text}</span>)}</span>
            : <span className="whitespace-pre px-1 text-ink">{line.content}</span>}
          {line.noNewline && <span className="select-none px-1 text-ink-tertiary" title={t('artifact.diffView.noNewline')}>&#8626;&#824;</span>}
        </div>
      ))}
    </>
  )
}

function FileDiff({ file, expanded, collapsed, viewMode, onToggleCollapse, onShowFull, onCollapseFull }: {
  file: DiffFile; expanded?: DiffFile; collapsed?: boolean; viewMode: 'unified' | 'split'
  onToggleCollapse: (path: string) => void; onShowFull?: (path: string) => void; onCollapseFull?: (path: string) => void
}) {
  const { t } = useTranslation()
  const chip = STATUS_CHIP[file.status]
  const shown = expanded ?? file
  const isExpanded = !!expanded
  const isCollapsed = !!collapsed
  return (
    <div id={`diff-file-${file.path}`} className="border-b border-border" data-testid="diff-file">
      <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 bg-surface-muted px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <button
            aria-label={isCollapsed ? t('artifact.diffView.expand') : t('artifact.diffView.collapse')}
            onClick={() => onToggleCollapse(file.path)}
            className="shrink-0 text-ink-tertiary hover:text-ink"
            data-testid="diff-file-collapse-toggle"
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <span className={cn('shrink-0 rounded px-1 font-medium', chip.cls)} data-testid="diff-status">
            <span className="text-caption">{t(chip.key)}</span>
          </span>
          <span className="truncate font-mono text-meta text-ink">
            {file.oldPath && <span className="text-ink-tertiary">{file.oldPath} → </span>}{file.path}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-caption">
          {file.truncated && <span className="text-ink-tertiary">{t('artifact.truncated')}</span>}
          <span className="text-success">+{file.additions}</span>
          <span className="text-danger">-{file.deletions}</span>
        </span>
      </div>
      {!isCollapsed && (shown.binary ? (
        <div className="px-3 py-2 text-meta text-ink-tertiary">{t('artifact.diffView.binary')}</div>
      ) : shown.hunks.length === 0 ? (
        <div className="px-3 py-2 text-meta text-ink-tertiary">{t('artifact.diffView.modeOnly')}</div>
      ) : (
        <>
          <div className="overflow-x-auto font-mono text-meta leading-relaxed">
            {shown.hunks.map((h, i) => <HunkLines key={i} hunk={h} viewMode={viewMode} />)}
          </div>
          {(onShowFull || onCollapseFull) && (
            <div className="flex justify-center gap-3 border-t border-border py-1 text-caption text-ink-tertiary">
              {!isExpanded
                ? onShowFull && <button data-testid="diff-show-full" onClick={() => onShowFull(file.path)}>{t('artifact.diffView.showFull')}</button>
                : onCollapseFull && <button data-testid="diff-collapse-full" onClick={() => onCollapseFull(file.path)}>{t('artifact.diffView.collapseFull')}</button>}
            </div>
          )}
        </>
      ))}
    </div>
  )
}

export function Empty({ icon, title, desc, children }: { icon?: ReactNode; title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-ink-tertiary">
      <span className="text-stat opacity-40">{icon ?? '±'}</span>
      <div className="text-body">{title}</div>
      {desc && <div className="max-w-[220px] text-center text-meta opacity-70">{desc}</div>}
      {children}
    </div>
  )
}

/** Pure, props-driven diff list (file jump-list + per-file hunks). Shared by Diff / Timeline / Changes. */
export function DiffDisplay({ files, summary, viewMode, expanded, collapsed, onToggleCollapse, onShowFull, onCollapseFull }: {
  files: DiffFile[]
  summary?: DiffSummary
  viewMode: 'unified' | 'split'
  expanded?: Record<string, DiffFile>
  collapsed?: Record<string, boolean>
  onToggleCollapse: (path: string) => void
  onShowFull?: (path: string) => void
  onCollapseFull?: (path: string) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      {files.length > 1 && (
        <div className="shrink-0 border-b border-border bg-surface" data-testid="diff-file-list">
          {files.map((file) => (
            <button
              key={file.path}
              data-testid="diff-file-jump"
              onClick={() => document.getElementById(`diff-file-${file.path}`)?.scrollIntoView({ block: 'start' })}
              className="flex w-full items-center justify-between px-3 py-0.5 text-meta hover:bg-surface-muted"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn('shrink-0 rounded px-1 text-caption font-medium', STATUS_CHIP[file.status].cls)}>{t(STATUS_CHIP[file.status].key)}</span>
                <span className="truncate font-mono text-ink-secondary">{file.path}</span>
              </span>
              <span className="shrink-0 font-mono text-caption"><span className="text-success">+{file.additions}</span> <span className="text-danger">-{file.deletions}</span></span>
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {files.map((file, i) => (
          <FileDiff
            key={`${file.path}-${i}`}
            file={file}
            expanded={expanded?.[file.path]}
            collapsed={collapsed?.[file.path]}
            viewMode={viewMode}
            onToggleCollapse={onToggleCollapse}
            onShowFull={onShowFull}
            onCollapseFull={onCollapseFull}
          />
        ))}
        {(summary?.totalFiles ?? 0) > files.length && (
          <div className="px-3 py-2 text-meta text-ink-tertiary">
            {t('artifact.diffView.moreFiles', { count: (summary!.totalFiles) - files.length })}
          </div>
        )}
      </div>
    </>
  )
}
