import { Fragment, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FolderOpen, MoreHorizontal, Trash2 } from 'lucide-react'
import type { DiffFile, DiffHunk, DiffLine, DiffLineType, DiffFileStatus, DiffSummary } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { fileIconForName } from '@/lib/fileIcon'
import { computeHunkWordDiffs } from '@/lib/wordDiff'
import { buildSplitRows } from '@/lib/diffSplit'
import { copyText } from '@/ipc/clipboard'
import { useDiffAnnotationStore } from '@/store/diffAnnotationStore'
import { setComposerQuote } from '@/components/command-palette/composerBridge'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { EmptyState } from '@/components/ui/EmptyState'
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from '@/components/ui/Popover'
import { Button } from '@/components/ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'

export const STATUS_CHIP = {
  added: { cls: 'bg-success/10 text-success', key: 'artifact.diffView.statusAdded', letter: 'A' },
  modified: { cls: 'bg-warning/10 text-warning', key: 'artifact.diffView.statusModified', letter: 'M' },
  deleted: { cls: 'bg-danger/10 text-danger', key: 'artifact.diffView.statusDeleted', letter: 'D' },
  renamed: { cls: 'bg-surface-muted text-ink-secondary', key: 'artifact.diffView.statusRenamed', letter: 'R' },
} as const satisfies Record<DiffFileStatus, { cls: string; key: string; letter: string }>

function DiffFileTypeIcon({ path, size = 14 }: { path: string; size?: number }) {
  const { Icon, className } = fileIconForName(path)
  return (
    <Icon
      size={size}
      strokeWidth={1.75}
      className={cn('shrink-0', className)}
      data-testid="file-type-icon"
    />
  )
}

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

/** Hunk 标题行：始终整行横贯，split 模式下位于左右两栏上方。 */
function HunkHeader({ hunk, path, sessionId }: { hunk: DiffHunk; path: string; sessionId: string }) {
  const { t } = useTranslation()
  const hunkText = formatHunkText(hunk)
  return (
    <DeclarativeContextMenu
      kind="diffHunk"
      payload={{ path, header: hunk.header, text: hunkText }}
      className="group/hunk flex border-y border-border/50 bg-surface-subtle py-0.5 text-caption text-ink-tertiary"
      data-testid="diff-hunk-header"
    >
      <span className="shrink-0 select-none px-2 font-mono tabular-nums text-ink-tertiary">@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
      {hunk.header && <span className="truncate px-1 text-ink-tertiary/80">{hunk.header}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-0.5 pr-1 opacity-0 transition-opacity duration-chrome group-hover/hunk:opacity-100">
        <button
          type="button"
          onClick={() => void copyText(hunkText)}
          className="rounded-sm px-1.5 py-0.5 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
          data-testid="diff-hunk-copy"
        >
          {t('contextMenu.diffHunk.copy')}
        </button>
        <button
          type="button"
          onClick={() => useDiffAnnotationStore.getState().add(sessionId, { path: path || '(unknown)', body: hunkText })}
          className="rounded-sm px-1.5 py-0.5 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
          data-testid="diff-hunk-annotate"
        >
          {t('contextMenu.diffHunk.annotate')}
        </button>
        <button
          type="button"
          onClick={() => setComposerQuote(`${path}\n${hunkText}`)}
          className="rounded-sm px-1.5 py-0.5 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
          data-testid="diff-hunk-quote"
        >
          {t('contextMenu.diffHunk.quoteToComposer')}
        </button>
      </span>
    </DeclarativeContextMenu>
  )
}

function HunkLines({
  hunk,
  path,
  sessionId,
}: {
  hunk: DiffHunk
  path: string
  sessionId: string
}) {
  const { t } = useTranslation()
  const spans = computeHunkWordDiffs(hunk.lines)
  return (
    <>
      <HunkHeader hunk={hunk} path={path} sessionId={sessionId} />
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

/** split 模式单侧单元格：整行按内容宽度扩展，背景至少铺满整栏。 */
function SplitCell({ line, side }: { line: DiffLine | null; side: 'left' | 'right' }) {
  if (!line) {
    return <div className="flex w-max min-w-full leading-[1.55] bg-surface-subtle/50"><span className="w-full" /></div>
  }
  return (
    <div className={cn('flex w-max min-w-full leading-[1.55]', lineStyle(line.type))}>
      <span className="w-9 shrink-0 select-none px-1 text-right font-mono tabular-nums text-caption text-ink-tertiary/80">
        {side === 'left' ? line.oldNo ?? '' : line.newNo ?? ''}
      </span>
      <span className={cn(
        'w-3.5 shrink-0 select-none text-center text-caption',
        side === 'left' && line.type === 'del' && 'text-danger',
        side === 'right' && line.type === 'add' && 'text-success',
      )}>
        {sign(line.type)}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre px-1.5 text-ink">{line.content}</span>
    </div>
  )
}

/** split 模式：每个 hunk 标题行横贯整宽，下方左右两栏各自横向滚动，超长行只在本栏内滚动。 */
function SplitHunks({ hunks, path, sessionId }: { hunks: DiffHunk[]; path: string; sessionId: string }) {
  return (
    <>
      {hunks.map((h, i) => (
        <Fragment key={i}>
          <HunkHeader hunk={h} path={path} sessionId={sessionId} />
          <div className="flex">
            <div className="min-w-0 flex-1 overflow-x-auto">
              {buildSplitRows(h.lines).map((row, j) => (
                <SplitCell key={j} line={row.left} side="left" />
              ))}
            </div>
            <div className="w-px shrink-0 bg-border/70" />
            <div className="min-w-0 flex-1 overflow-x-auto">
              {buildSplitRows(h.lines).map((row, j) => (
                <SplitCell key={j} line={row.right} side="right" />
              ))}
            </div>
          </div>
        </Fragment>
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
  showFileIcons,
  focusedPath,
  running,
  discardOpenPath,
  discardPending,
  onDiscardOpen,
  onDiscardConfirm,
  onOpenInFiles,
  onReviewFile,
  onCopyPath,
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
  showFileIcons: boolean
  focusedPath?: string | null
  running: boolean
  discardOpenPath: string | null
  discardPending?: Record<string, boolean>
  onDiscardOpen: (path: string | null) => void
  onDiscardConfirm: (path: string, file: DiffFile) => void
  onOpenInFiles: (path: string) => void
  onReviewFile: (path: string) => void
  onCopyPath: (path: string) => void
  onToggleCollapse: (path: string, multi: boolean) => void
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
          // Only expanded rows stick; offsets are assigned by DiffDisplay's layout effect
          // so multiple open rows stack instead of overlapping.
          'group relative flex h-8 items-center justify-between gap-2 bg-surface-subtle px-3',
          !isCollapsed && 'sticky top-0 z-[1]',
          // Expanded: hairline under sticky bar. Collapsed: shell border-b alone (no double).
          !isCollapsed && 'border-b border-border/70',
        )}
        data-testid="diff-file-header"
      >
        {focusedPath === file.path && <div className="pointer-events-none absolute inset-y-1 left-0 w-0.5 rounded-r bg-accent" />}
        <span
          className="flex min-w-0 flex-1 items-center gap-1.5 text-meta leading-none"
          data-expanded={isCollapsed ? 'false' : 'true'}
        >
          <button
            aria-label={isCollapsed ? t('artifact.diffView.expand') : t('artifact.diffView.collapse')}
            onClick={(e) => onToggleCollapse(file.path, e.metaKey || e.ctrlKey)}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
            data-testid="diff-file-collapse-toggle"
          >
            {isCollapsed ? <ChevronRight size={14} strokeWidth={1.75} /> : <ChevronDown size={14} strokeWidth={1.75} />}
          </button>
          <span
            className={cn('shrink-0 rounded-md px-1.5 py-px text-caption font-medium', chip.cls)}
            title={t(chip.key)}
            aria-label={t(chip.key)}
            data-testid="diff-status"
          >
            {chip.letter}
          </span>
          {showFileIcons && <DiffFileTypeIcon path={file.path} size={14} />}
          <span className="min-w-0 truncate font-mono text-ink">
            {file.oldPath && <span className="text-ink-tertiary">{file.oldPath} → </span>}{file.path}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 font-mono text-caption leading-none tabular-nums">
          {file.truncated && <span className="text-ink-tertiary">{t('artifact.truncated')}</span>}
          <span className="text-success">+{file.additions}</span>
          <span className="text-danger">−{file.deletions}</span>
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-chrome group-hover:opacity-100">
            <Popover
              open={discardOpenPath === file.path}
              onOpenChange={(open) => onDiscardOpen(open ? file.path : null)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={running || discardPending?.[file.path]}
                  title={running ? t('artifact.changesView.discardRunningDisabled') : t('artifact.changesView.discard')}
                  className="inline-flex size-5 items-center justify-center rounded text-ink-tertiary transition-colors duration-chrome hover:bg-danger/10 hover:text-danger disabled:pointer-events-none disabled:opacity-40"
                  data-testid="diff-discard"
                >
                  <Trash2 size={13} strokeWidth={1.75} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" data-testid="diff-discard-popover">
                <div className="space-y-2 p-3">
                  <p className="text-body font-medium text-ink">{t('artifact.changesView.discardConfirmTitle')}</p>
                  <p className="text-meta text-ink-tertiary">{t('artifact.changesView.discardConfirmBody')}</p>
                  <div className="flex justify-end gap-2 pt-1">
                    <PopoverClose asChild>
                      <Button size="sm" variant="ghost">{t('artifact.changesView.discardCancel')}</Button>
                    </PopoverClose>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => onDiscardConfirm(file.path, file)}
                      data-testid="diff-discard-confirm"
                    >
                      {t('artifact.changesView.discardConfirmAction')}
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <button
              type="button"
              title={t('artifact.changesView.openInFiles')}
              onClick={() => onOpenInFiles(file.path)}
              className="inline-flex size-5 items-center justify-center rounded text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
              data-testid="diff-open-files"
            >
              <FolderOpen size={13} strokeWidth={1.75} />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t('artifact.changesView.fileActions')}
                  className="inline-flex size-5 items-center justify-center rounded text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
                  data-testid="diff-file-menu"
                >
                  <MoreHorizontal size={13} strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" data-testid="diff-file-menu-content">
                <DropdownMenuItem onClick={() => onCopyPath(file.path)} data-testid="diff-file-copy-path">
                  {t('contextMenu.diffFile.copyPath')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onOpenInFiles(file.path)} data-testid="diff-file-menu-open">
                  {t('contextMenu.diffFile.openInFiles')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onReviewFile(file.path)} data-testid="diff-file-menu-review">
                  {t('artifact.changesView.reviewFile')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </span>
      </DeclarativeContextMenu>
      {!isCollapsed && (shown.binary ? (
        <div className="px-3 py-2.5 text-meta text-ink-tertiary">{t('artifact.diffView.binary')}</div>
      ) : shown.hunks.length === 0 ? (
        <div className="px-3 py-2.5 text-meta text-ink-tertiary">{t('artifact.diffView.modeOnly')}</div>
      ) : (
        <>
          <div className={cn('font-mono text-meta', viewMode === 'unified' && 'overflow-x-auto')}>
            {viewMode === 'split' ? (
              <SplitHunks hunks={shown.hunks} path={file.path} sessionId={sessionId} />
            ) : (
              shown.hunks.map((h, i) => (
                <HunkLines key={i} hunk={h} path={file.path} sessionId={sessionId} />
              ))
            )}
          </div>
          {(onShowFull || onCollapseFull) && (
            <div className="flex justify-center gap-3 border-t border-border/70 py-1.5 text-caption text-ink-tertiary">
              {!isExpanded
                ? onShowFull && (
                    <button
                      type="button"
                      data-testid="diff-show-full"
                      onClick={() => onShowFull(file.path)}
                      className="rounded-sm px-2 py-0.5 transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
                    >
                      {t('artifact.diffView.showFull')}
                    </button>
                  )
                : onCollapseFull && (
                    <button
                      type="button"
                      data-testid="diff-collapse-full"
                      onClick={() => onCollapseFull(file.path)}
                      className="rounded-sm px-2 py-0.5 transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
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

/** Panel empty — shared visual with ui/EmptyState (artifact panels stay full-height). */
export function Empty({
  icon,
  title,
  desc,
  children,
}: {
  icon?: ReactNode
  title: string
  desc?: string
  children?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center" data-testid="artifact-empty">
      <EmptyState
        tier="professional"
        title={title}
        description={desc}
        className="py-10"
      >
        {icon != null ? (
          <span className="text-stat text-ink-tertiary opacity-40" aria-hidden>
            {icon}
          </span>
        ) : (
          <span className="text-stat text-ink-tertiary opacity-35" aria-hidden>
            ±
          </span>
        )}
      </EmptyState>
      {children ? <div className="mt-1 flex justify-center">{children}</div> : null}
    </div>
  )
}

/**
 * Pure, props-driven diff list (single accordion; no jump-list). Shared by
 * Diff / Timeline / Changes. Only expanded rows stick, stacked in open order.
 */
export function DiffDisplay({
  files,
  summary,
  viewMode,
  expanded,
  collapsed,
  sessionId,
  cwd = null,
  showFileIcons = true,
  focusedPath = null,
  running = false,
  discardOpenPath = null,
  discardPending,
  onDiscardOpen = () => {},
  onDiscardConfirm = () => {},
  onOpenInFiles = () => {},
  onReviewFile = () => {},
  onCopyPath = () => {},
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
  /** Narrow panels hide file-type icons to reclaim horizontal space. */
  showFileIcons?: boolean
  /** Keyboard-focused file row (j/k); highlighted with an accent rail. */
  focusedPath?: string | null
  running?: boolean
  discardOpenPath?: string | null
  discardPending?: Record<string, boolean>
  onDiscardOpen?: (path: string | null) => void
  onDiscardConfirm?: (path: string, file: DiffFile) => void
  onOpenInFiles?: (path: string) => void
  onReviewFile?: (path: string) => void
  onCopyPath?: (path: string) => void
  onToggleCollapse: (path: string, multi: boolean) => void
  onShowFull?: (path: string) => void
  onCollapseFull?: (path: string) => void
}) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Stack sticky headers in expansion order: each expanded header's top offset
  // is the cumulative height of the expanded headers before it. Collapsed rows
  // lose stickiness entirely (no offset, no sticky class).
  useLayoutEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const headers = root.querySelectorAll<HTMLElement>('[data-testid="diff-file-header"]')
    let acc = 0
    for (const h of headers) {
      const flag = h.querySelector<HTMLElement>('[data-expanded]')
      if (flag?.dataset.expanded === 'true') {
        h.style.top = `${acc}px`
        acc += h.offsetHeight
      } else {
        h.style.top = ''
      }
    }
  })

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      {files.map((file, i) => (
        <FileDiff
          key={`${file.path}-${i}`}
          file={file}
          expanded={expanded?.[file.path]}
          collapsed={collapsed?.[file.path]}
          viewMode={viewMode}
          sessionId={sessionId}
          cwd={cwd}
          showFileIcons={showFileIcons}
          focusedPath={focusedPath}
          running={running}
          discardOpenPath={discardOpenPath}
          discardPending={discardPending}
          onDiscardOpen={onDiscardOpen}
          onDiscardConfirm={onDiscardConfirm}
          onOpenInFiles={onOpenInFiles}
          onReviewFile={onReviewFile}
          onCopyPath={onCopyPath}
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
  )
}
