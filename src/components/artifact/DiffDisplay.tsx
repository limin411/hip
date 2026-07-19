import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { DiffFile, DiffHunk, DiffLine, DiffLineType, DiffFileStatus, DiffSummary } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { computeHunkWordDiffs } from '@/lib/wordDiff'
import { buildSplitRows } from '@/lib/diffSplit'
import { DeclarativeContextMenu } from '@/components/context-menu'

export const STATUS_CHIP = {
  added: { cls: 'bg-success/10 text-success', key: 'artifact.diffView.statusAdded' },
  modified: { cls: 'bg-warning/10 text-warning', key: 'artifact.diffView.statusModified' },
  deleted: { cls: 'bg-danger/10 text-danger', key: 'artifact.diffView.statusDeleted' },
  renamed: { cls: 'bg-surface-muted text-ink-secondary', key: 'artifact.diffView.statusRenamed' },
} as const satisfies Record<DiffFileStatus, { cls: string; key: string }>

/** Soft row tint — hierarchy from background, not hard borders. */
function lineStyle(t: DiffLineType): string {
  return t === 'add' ? 'bg-success/[0.07]' : t === 'del' ? 'bg-danger/[0.07]' : ''
}
function sign(t: DiffLineType): string { return t === 'add' ? '+' : t === 'del' ? '-' : ' ' }

function formatHunkText(hunk: DiffHunk): string {
  const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${hunk.header ? ` ${hunk.header}` : ''}`
  const body = hunk.lines.map((line) => `${sign(line.type)}${line.content}`).join('\n')
  return `${header}\n${body}`
}

function HunkLines({
  hunk,
  viewMode,
  path,
}: {
  hunk: DiffHunk
  viewMode: 'unified' | 'split'
  path: string
}) {
  const { t } = useTranslation()
  const hunkText = formatHunkText(hunk)
  const headerRow = (
    <DeclarativeContextMenu
      kind="diffHunk"
      payload={{ path, header: hunk.header, text: hunkText }}
      className="flex border-y border-border/50 bg-surface-subtle py-0.5 text-caption text-ink-tertiary"
      data-testid="diff-hunk-header"
    >
      <span className="shrink-0 select-none px-2 font-mono tabular-nums text-ink-tertiary">@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
      {hunk.header && <span className="truncate px-1 text-ink-tertiary/80">{hunk.header}</span>}
    </DeclarativeContextMenu>
  )

  if (viewMode === 'split') {
    const splitRows = buildSplitRows(hunk.lines)
    return (
      <>
        {headerRow}
        {splitRows.map((row, i) => (
          <div key={i} className="flex leading-[1.55]">
            <div className={cn('flex min-w-0 flex-1', row.left ? lineStyle(row.left.type) : 'bg-surface-subtle/50')}>
              {row.left ? (
                <>
                  <span className="w-9 shrink-0 select-none px-1 text-right font-mono tabular-nums text-caption text-ink-tertiary/80">{row.left.oldNo ?? ''}</span>
                  <span className={cn('w-3.5 shrink-0 select-none text-center text-caption', row.left.type === 'del' && 'text-danger')}>{sign(row.left.type)}</span>
                  <span className="min-w-0 flex-1 whitespace-pre px-1.5 text-ink">{row.left.content}</span>
                </>
              ) : (<span className="w-full" />)}
            </div>
            <div className="w-px shrink-0 bg-border/70" />
            <div className={cn('flex min-w-0 flex-1', row.right ? lineStyle(row.right.type) : 'bg-surface-subtle/50')}>
              {row.right ? (
                <>
                  <span className="w-9 shrink-0 select-none px-1 text-right font-mono tabular-nums text-caption text-ink-tertiary/80">{row.right.newNo ?? ''}</span>
                  <span className={cn('w-3.5 shrink-0 select-none text-center text-caption', row.right.type === 'add' && 'text-success')}>{sign(row.right.type)}</span>
                  <span className="min-w-0 flex-1 whitespace-pre px-1.5 text-ink">{row.right.content}</span>
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
      {headerRow}
      {hunk.lines.map((line: DiffLine, i) => (
        <div key={i} className={cn('flex leading-[1.55]', lineStyle(line.type))}>
          <span className="w-9 shrink-0 select-none px-1 text-right font-mono tabular-nums text-caption text-ink-tertiary/80">{line.oldNo ?? ''}</span>
          <span className="w-9 shrink-0 select-none px-1 text-right font-mono tabular-nums text-caption text-ink-tertiary/80">{line.newNo ?? ''}</span>
          <span className={cn('w-3.5 shrink-0 select-none text-center text-caption', line.type === 'add' && 'text-success', line.type === 'del' && 'text-danger')}>{sign(line.type)}</span>
          {spans[i]
            ? <span className="min-w-0 flex-1 whitespace-pre px-1.5 text-ink">{spans[i]!.map((sp, k) => <span key={k} className={cn(sp.changed && (line.type === 'add' ? 'bg-success/25' : 'bg-danger/25'))}>{sp.text}</span>)}</span>
            : <span className="min-w-0 flex-1 whitespace-pre px-1.5 text-ink">{line.content}</span>}
          {line.noNewline && <span className="select-none px-1 text-ink-tertiary" title={t('artifact.diffView.noNewline')}>&#8626;&#824;</span>}
        </div>
      ))}
    </>
  )
}

function FileDiff({
  file,
  expanded,
  collapsed,
  viewMode,
  sessionId,
  cwd,
  onToggleCollapse,
  onShowFull,
  onCollapseFull,
}: {
  file: DiffFile
  expanded?: DiffFile
  collapsed?: boolean
  viewMode: 'unified' | 'split'
  sessionId: string
  cwd: string | null
  onToggleCollapse: (path: string) => void
  onShowFull?: (path: string) => void
  onCollapseFull?: (path: string) => void
}) {
  const { t } = useTranslation()
  const chip = STATUS_CHIP[file.status]
  const shown = expanded ?? file
  const isExpanded = !!expanded
  const isCollapsed = !!collapsed
  return (
    <div id={`diff-file-${file.path}`} className="border-b border-border/80" data-testid="diff-file">
      <DeclarativeContextMenu
        kind="diffFile"
        payload={{ path: file.path, status: file.status, sessionId, cwd }}
        className={cn(
          'sticky top-0 z-[1] flex h-8 items-center justify-between gap-2 bg-surface-subtle/95 px-3 backdrop-blur-[2px]',
          // Expanded: hairline under sticky bar. Collapsed: shell border-b alone (no double).
          !isCollapsed && 'border-b border-border/70',
        )}
        data-testid="diff-file-header"
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-meta leading-none">
          <button
            aria-label={isCollapsed ? t('artifact.diffView.expand') : t('artifact.diffView.collapse')}
            onClick={() => onToggleCollapse(file.path)}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
            data-testid="diff-file-collapse-toggle"
          >
            {isCollapsed ? <ChevronRight size={14} strokeWidth={1.75} /> : <ChevronDown size={14} strokeWidth={1.75} />}
          </button>
          <span className="min-w-0 truncate">
            <span
              className={cn('mr-1.5 rounded-md px-1.5 py-px text-caption font-medium', chip.cls)}
              data-testid="diff-status"
            >
              {t(chip.key)}
            </span>
            <span className="font-mono text-ink">
              {file.oldPath && <span className="text-ink-tertiary">{file.oldPath} → </span>}{file.path}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 font-mono text-caption leading-none tabular-nums">
          {file.truncated && <span className="text-ink-tertiary">{t('artifact.truncated')}</span>}
          <span className="text-success">+{file.additions}</span>
          <span className="text-danger">−{file.deletions}</span>
        </span>
      </DeclarativeContextMenu>
      {!isCollapsed && (shown.binary ? (
        <div className="px-3 py-2.5 text-meta text-ink-tertiary">{t('artifact.diffView.binary')}</div>
      ) : shown.hunks.length === 0 ? (
        <div className="px-3 py-2.5 text-meta text-ink-tertiary">{t('artifact.diffView.modeOnly')}</div>
      ) : (
        <>
          <div className="overflow-x-auto font-mono text-meta">
            {shown.hunks.map((h, i) => (
              <HunkLines key={i} hunk={h} viewMode={viewMode} path={file.path} />
            ))}
          </div>
          {(onShowFull || onCollapseFull) && (
            <div className="flex justify-center gap-3 border-t border-border/70 py-1.5 text-caption text-ink-tertiary">
              {!isExpanded
                ? onShowFull && (
                    <button
                      type="button"
                      data-testid="diff-show-full"
                      onClick={() => onShowFull(file.path)}
                      className="rounded-md px-2 py-0.5 transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
                    >
                      {t('artifact.diffView.showFull')}
                    </button>
                  )
                : onCollapseFull && (
                    <button
                      type="button"
                      data-testid="diff-collapse-full"
                      onClick={() => onCollapseFull(file.path)}
                      className="rounded-md px-2 py-0.5 transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
                    >
                      {t('artifact.diffView.collapseFull')}
                    </button>
                  )}
            </div>
          )}
        </>
      ))}
    </div>
  )
}

export function Empty({ icon, title, desc, children }: { icon?: ReactNode; title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-14 text-ink-tertiary">
      <span className="text-stat opacity-35">{icon ?? '±'}</span>
      <div className="text-body font-medium tracking-tight text-ink-secondary">{title}</div>
      {desc && <div className="max-w-[240px] text-center text-meta leading-relaxed text-ink-tertiary">{desc}</div>}
      {children}
    </div>
  )
}

/** Pure, props-driven diff list (file jump-list + per-file hunks). Shared by Diff / Timeline / Changes. */
export function DiffDisplay({
  files,
  summary,
  viewMode,
  expanded,
  collapsed,
  sessionId,
  cwd = null,
  onToggleCollapse,
  onShowFull,
  onCollapseFull,
}: {
  files: DiffFile[]
  summary?: DiffSummary
  viewMode: 'unified' | 'split'
  expanded?: Record<string, DiffFile>
  collapsed?: Record<string, boolean>
  /** Required for context-menu path / collapse actions. */
  sessionId: string
  cwd?: string | null
  onToggleCollapse: (path: string) => void
  onShowFull?: (path: string) => void
  onCollapseFull?: (path: string) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      {files.length > 1 && (
        <div className="shrink-0 border-b border-border/80 bg-surface" data-testid="diff-file-list">
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              data-testid="diff-file-jump"
              onClick={() => document.getElementById(`diff-file-${file.path}`)?.scrollIntoView({ block: 'start' })}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-meta leading-none transition-colors duration-chrome hover:bg-state-hover"
            >
              <span className="min-w-0 flex-1 truncate text-left">
                <span className={cn('mr-1.5 rounded-md px-1.5 py-px text-caption font-medium', STATUS_CHIP[file.status].cls)}>{t(STATUS_CHIP[file.status].key)}</span>
                <span className="font-mono text-ink-secondary">{file.path}</span>
              </span>
              <span className="shrink-0 font-mono text-caption tabular-nums">
                <span className="text-success">+{file.additions}</span>{' '}
                <span className="text-danger">−{file.deletions}</span>
              </span>
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
            sessionId={sessionId}
            cwd={cwd}
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
