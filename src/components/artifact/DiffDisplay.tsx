import { Fragment, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, FolderOpen, MessageSquarePlus, MoreHorizontal, RefreshCw, Search, Trash2, X } from 'lucide-react'
import type { DiffFile, DiffHunk, DiffLine, DiffLineType, DiffFileStatus, DiffSummary } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { fileIconForName } from '@/lib/fileIcon'
import { computeHunkWordDiffs, wordDiff, type WordDiffSpan } from '@/lib/wordDiff'
import { buildSplitRows, type SplitRow } from '@/lib/diffSplit'
import { setComposerQuote, insertComposerText } from '@/components/command-palette/composerBridge'
import { copyText } from '@/ipc/clipboard'
import { toast } from 'sonner'
import {
  CODE_BLOCK_CHROME,
  normalizeCodeBlockThemeId,
  type CodeBlockChromePalette,
} from '@/domain/knowledge/codeBlockTheme'
import { useDiffAnnotationStore } from '@/store/diffAnnotationStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
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
  added: { cls: 'bg-diff-add/[0.13] text-diff-add', key: 'artifact.diffView.statusAdded', letter: 'A' },
  modified: { cls: 'bg-warning/10 text-warning', key: 'artifact.diffView.statusModified', letter: 'M' },
  deleted: { cls: 'bg-diff-del/[0.13] text-diff-del', key: 'artifact.diffView.statusDeleted', letter: 'D' },
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

/** 变更块内位置：first/mid/last/single（单行块），null = 上下文行。 */
type BlockPos = 'first' | 'mid' | 'last' | 'single' | null

/** 行级视觉：底色 13%（深色档 22%）+ hover（T1，对齐预览原型；alpha 走 --diff-bg-a/--diff-hover-a）。
 *  色条用 border-left 3px（T1）：inset shadow 绘制在子元素背景之下，会被行号列底纹遮挡——
 *  border 在内容之外不受影响。所有行（含 ctx）保留 border-l-[3px] 占位，行号列对齐；
 *  颜色走内联（--diff-* 变量，随主题/代码块明度覆盖）。 */
function lineStyle(t: DiffLineType, pos: BlockPos = null): string {
  if (t === 'ctx') return 'border-l-[3px] border-transparent'
  const tint = t === 'add' ? 'diff-add-bg' : 'diff-del-bg'
  return cn(tint, 'border-l-[3px]', blockPosCls(pos))
}

/** T1 色条颜色（行 div 内联；--diff-* 变量随主题/代码块明度覆盖）。 */
function railColor(t: DiffLineType): string {
  return t === 'add' ? 'rgb(var(--diff-add-rgb))' : 'rgb(var(--diff-del-rgb))'
}

/** T2 块描边（inset 1px，24% 主色，对齐原型）。split 块用中性边框 100%（原型 var(--border)）。 */
function lineShadow(t: DiffLineType, split: boolean, chrome: CodeBlockChromePalette | null): string | undefined {
  if (t === 'ctx') return undefined
  if (split) return `inset 0 0 0 1px ${chrome?.border ?? 'rgb(var(--border-rgb))'}`
  const c = t === 'add' ? 'var(--diff-add-rgb)' : 'var(--diff-del-rgb)'
  return `inset 0 0 0 1px rgb(${c} / 0.24)`
}

/** 块位置类：首/末行圆角 + 与相邻上下文行留 1px 间距。 */
function blockPosCls(pos: BlockPos): string {
  if (pos === 'first') return 'mt-[3px] rounded-t-[6px]'
  if (pos === 'last') return 'mb-[3px] rounded-b-[6px]'
  if (pos === 'single') return 'mt-[3px] mb-[3px] rounded-[6px]'
  return ''
}

/** 连续变更行的块位置表：index → BlockPos（上下文行为 null）。isChange 谓词支持 split 行配对（任一侧变更即入块）。 */
function changeRunPositions<T>(lines: T[], isChange: (l: T) => boolean): BlockPos[] {
  const pos: BlockPos[] = lines.map(() => null)
  let i = 0
  while (i < lines.length) {
    if (!isChange(lines[i])) {
      i++
      continue
    }
    let j = i
    while (j < lines.length && isChange(lines[j])) j++
    const len = j - i
    for (let k = i; k < j; k++) pos[k] = len === 1 ? 'single' : k === i ? 'first' : k === j - 1 ? 'last' : 'mid'
    i = j
  }
  return pos
}

/** 行号列（T3）：独立底纹 62%（对齐原型）+ 行类型着色全强度；unified 第二列（split 单列）带右侧分隔线。 */
function lnCls(line: DiffLine): string {
  return cn(
    'w-9 shrink-0 select-none px-1 text-right font-mono tabular-nums text-caption bg-surface-subtle/[0.62]',
    line.type === 'add' ? 'text-diff-add' : line.type === 'del' ? 'text-diff-del' : 'text-ink-tertiary/80',
  )
}

function sign(t: DiffLineType): string { return t === 'add' ? '+' : t === 'del' ? '-' : ' ' }

/** 行内容（T4）：word diff 高亮 span（35% 主色 + 2px 圆角内衬），无配对时裸文本。 */
function LineContent({
  spans,
  text,
  type,
  chrome,
}: {
  spans: WordDiffSpan[] | null
  text: string
  type: DiffLineType
  chrome: CodeBlockChromePalette | null
}) {
  return (
    <span
      style={chrome ? { color: chrome.text } : undefined}
      className="min-w-0 flex-1 whitespace-pre px-1.5 text-ink"
    >
      {spans
        ? spans.map((sp, k) => (
            <span
              key={k}
              className={cn(
                sp.changed &&
                  (type === 'add' ? 'bg-diff-add/[0.36] rounded-[2px]' : 'bg-diff-del/[0.36] rounded-[2px]'),
              )}
            >
              {sp.text}
            </span>
          ))
        : text}
    </span>
  )
}

/** 超长行跳过 word diff 计算（对齐 spec §7，>2000 字符）。 */
const WORD_DIFF_MAX_LEN = 2000

function formatHunkText(hunk: DiffHunk): string {
  const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${hunk.header ? ` ${hunk.header}` : ''}`
  const body = hunk.lines.map((line) => `${sign(line.type)}${line.content}`).join('\n')
  return `${header}\n${body}`
}

/** 完整 git diff 文本（含 diff --git 头），供文件级/全局复制（T13）。 */
export function formatFileDiff(file: DiffFile): string {
  const head = `diff --git a/${file.oldPath ?? file.path} b/${file.path}`
  const header =
    file.status === 'added'
      ? 'new file mode 100644'
      : file.status === 'deleted'
        ? 'deleted file mode 100644'
        : file.status === 'renamed'
          ? `similarity index 100%\nrename from ${file.oldPath}\nrename to ${file.path}`
          : ''
  return [head, header, `--- a/${file.oldPath ?? file.path}`, `+++ b/${file.path}`, ...file.hunks.map(formatHunkText)].filter(Boolean).join('\n')
}

/** Hunk 标题行：始终整行横贯，split 模式下位于左右两栏上方。 */
function HunkHeader({
  hunk,
  path,
  sessionId,
  chrome,
  expandable = false,
  onExpandContext,
}: {
  hunk: DiffHunk
  path: string
  sessionId: string
  chrome: CodeBlockChromePalette | null
  /** T11：文件上下文为数值档位时可展开（'full' 无更多可展开）。 */
  expandable?: boolean
  onExpandContext?: (path: string, dir: 'up' | 'down') => void
}) {
  const { t } = useTranslation()
  const hunkText = formatHunkText(hunk)
  // T5：hunk 徽标 +N −M（行计数派生）
  const adds = hunk.lines.filter((l) => l.type === 'add').length
  const dels = hunk.lines.filter((l) => l.type === 'del').length
  return (
    <DeclarativeContextMenu
      kind="diffHunk"
      payload={{ path, header: hunk.header, text: hunkText }}
      className="group/hunk border-y border-border/50"
      data-testid="diff-hunk-header"
    >
      <div
        role="group"
        aria-label={t('artifact.diffView.hunkLabel')}
        className="flex items-center bg-surface-subtle py-0.5 text-caption text-ink-tertiary"
        style={
          chrome
            ? {
                backgroundColor: chrome.headerBackground,
                borderColor: chrome.border,
                color: chrome.headerText,
              }
            : undefined
        }
      >
        <span
          className="shrink-0 select-none px-2 font-mono tabular-nums text-ink-tertiary"
          style={chrome ? { color: chrome.headerText } : undefined}
        >
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </span>
        <span
          className="shrink-0 rounded-md bg-surface-muted px-1.5 py-px font-mono tabular-nums"
          data-testid="diff-hunk-badge"
          style={chrome ? { backgroundColor: chrome.headerBackground, color: chrome.headerText } : undefined}
        >
          <span className="text-diff-add">+{adds}</span>{' '}
          <span className="text-diff-del">−{dels}</span>
        </span>
        {hunk.header && (
          <span
            className="truncate px-1 text-ink-tertiary/80"
            style={chrome ? { color: chrome.headerText } : undefined}
          >
            {hunk.header}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-0.5 pr-1">
          {expandable && onExpandContext && (
            <>
              <button
                type="button"
                onClick={() => onExpandContext(path, 'up')}
                className="rounded-sm px-1.5 py-0.5 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
                title={t('artifact.diffView.expandUpContext')}
                data-testid="diff-hunk-expand-up"
                style={chrome ? { color: chrome.headerText } : undefined}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => onExpandContext(path, 'down')}
                className="rounded-sm px-1.5 py-0.5 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
                title={t('artifact.diffView.expandDownContext')}
                data-testid="diff-hunk-expand-down"
                style={chrome ? { color: chrome.headerText } : undefined}
              >
                ↓
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void copyText(hunkText)}
            className="rounded-sm px-1.5 py-0.5 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
            data-testid="diff-hunk-copy"
            style={chrome ? { color: chrome.headerText } : undefined}
          >
            {t('contextMenu.diffHunk.copy')}
          </button>
          <button
            type="button"
            onClick={() => useDiffAnnotationStore.getState().add(sessionId, { path: path || '(unknown)', body: hunkText })}
            className="rounded-sm px-1.5 py-0.5 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
            data-testid="diff-hunk-annotate"
            style={chrome ? { color: chrome.headerText } : undefined}
          >
            {t('contextMenu.diffHunk.annotate')}
          </button>
          <button
            type="button"
            onClick={() => setComposerQuote(`${path}\n${hunkText}`)}
            className="rounded-sm px-1.5 py-0.5 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
            data-testid="diff-hunk-quote"
            style={chrome ? { color: chrome.headerText } : undefined}
          >
            {t('contextMenu.diffHunk.quoteToComposer')}
          </button>
          <button
            type="button"
            onClick={() => {
              const prompt = t('artifact.changesView.explainHunkPrompt', { path, text: hunkText })
              if (insertComposerText(prompt)) {
                toast.success(t('artifact.changesView.explainInjected'))
              } else {
                toast.error(t('artifact.changesView.reviewNoComposer'))
              }
            }}
            className="rounded-sm px-1.5 py-0.5 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
            data-testid="diff-hunk-explain"
            style={chrome ? { color: chrome.headerText } : undefined}
          >
            {t('artifact.changesView.explainHunk')}
          </button>
        </span>
      </div>
    </DeclarativeContextMenu>
  )
}

function HunkLines({
  hunk,
  path,
  sessionId,
  chrome,
  expandable,
  onExpandContext,
}: {
  hunk: DiffHunk
  path: string
  sessionId: string
  chrome: CodeBlockChromePalette | null
  expandable?: boolean
  onExpandContext?: (path: string, dir: 'up' | 'down') => void
}) {
  const { t } = useTranslation()
  const spans = computeHunkWordDiffs(hunk.lines)
  const runPos = changeRunPositions(hunk.lines, (l) => l.type !== 'ctx')
  return (
    <>
      <HunkHeader hunk={hunk} path={path} sessionId={sessionId} chrome={chrome} expandable={expandable} onExpandContext={onExpandContext} />
      {hunk.lines.map((line: DiffLine, i) => (
        <div
          key={i}
          role="row"
          aria-label={t(
            line.type === 'add'
              ? 'artifact.diffView.rowAdded'
              : line.type === 'del'
                ? 'artifact.diffView.rowDeleted'
                : 'artifact.diffView.rowContext',
          )}
          className={cn('flex leading-[1.55]', line.type !== 'ctx' && 'group', lineStyle(line.type, runPos[i]))}
          style={
            line.type !== 'ctx'
              ? {
                  boxShadow: lineShadow(line.type, false, chrome),
                  borderLeftColor: railColor(line.type),
                }
              : undefined
          }
        >
          <span
            className={lnCls(line)}
            style={
              chrome
                ? {
                    color: line.type === 'ctx' ? chrome.headerText : railColor(line.type),
                    backgroundColor: chrome.headerBackground,
                  }
                : undefined
            }
          >
            {line.oldNo ?? ''}
          </span>
          <span
            className={cn(lnCls(line), 'border-r border-border')}
            style={
              chrome
                ? {
                    color: line.type === 'ctx' ? chrome.headerText : railColor(line.type),
                    backgroundColor: chrome.headerBackground,
                    borderRightColor: chrome.border,
                  }
                : undefined
            }
          >
            {line.newNo ?? ''}
          </span>
          <span className={cn('w-3.5 shrink-0 select-none text-center text-caption', line.type === 'add' && 'text-diff-add', line.type === 'del' && 'text-diff-del')}>{sign(line.type)}</span>
          <LineContent spans={spans[i] ?? null} text={line.content} type={line.type} chrome={chrome} />
          {line.type !== 'ctx' && (
            <span className="invisible flex shrink-0 items-center gap-0.5 pr-1 group-hover:visible">
              <button
                type="button"
                title={t('artifact.changesView.copyLine')}
                onClick={(e) => {
                  e.stopPropagation()
                  void copyText(line.content)
                }}
                className="rounded-sm p-0.5 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
                data-testid="diff-line-copy"
              >
                <Copy size={11} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                title={t('artifact.changesView.quoteLine')}
                onClick={(e) => {
                  e.stopPropagation()
                  setComposerQuote(`${path}\n${line.content}`)
                }}
                className="rounded-sm p-0.5 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
                data-testid="diff-line-quote"
              >
                <MessageSquarePlus size={11} strokeWidth={1.75} />
              </button>
            </span>
          )}
          {line.noNewline && (
            <span
              className="select-none px-1 text-ink-tertiary"
              style={chrome ? { color: chrome.headerText } : undefined}
              title={t('artifact.diffView.noNewline')}
            >
              &#8626;&#824;
            </span>
          )}
        </div>
      ))}
    </>
  )
}

/** split 模式单侧单元格：整行按内容宽度扩展，背景至少铺满整栏。 */
function SplitCell({
  line,
  side,
  chrome,
  blockPos = null,
  wdSpans = null,
}: {
  line: DiffLine | null
  side: 'left' | 'right'
  chrome: CodeBlockChromePalette | null
  blockPos?: BlockPos
  wdSpans?: WordDiffSpan[] | null
}) {
  const { t } = useTranslation()
  if (!line) {
    return (
      <div
        role="row"
        aria-label={t('artifact.diffView.rowContext')}
        className={cn(
          'flex w-max min-w-full border-l-[3px] border-transparent leading-[1.55]',
          blockPos && blockPosCls(blockPos),
        )}
        style={
          blockPos
            ? {
                boxShadow: chrome
                  ? `inset 0 0 0 1px ${chrome.border}`
                  : 'inset 0 0 0 1px rgb(var(--border-rgb))',
                ...(chrome ? { backgroundColor: chrome.background, color: chrome.text } : {}),
              }
            : chrome
              ? { backgroundColor: chrome.background, color: chrome.text }
              : undefined
        }
      >
        <span className="w-full" />
      </div>
    )
  }
  return (
    <div
      role="row"
      aria-label={t(
        line.type === 'add'
          ? 'artifact.diffView.rowAdded'
          : line.type === 'del'
            ? 'artifact.diffView.rowDeleted'
            : 'artifact.diffView.rowContext',
      )}
      className={cn('flex w-max min-w-full leading-[1.55]', lineStyle(line.type, blockPos))}
      style={{
        ...(line.type !== 'ctx'
          ? { boxShadow: lineShadow(line.type, true, chrome), borderLeftColor: railColor(line.type) }
          : {}),
        ...(chrome ? { backgroundColor: chrome.background, color: chrome.text } : {}),
      }}
    >
      <span
        className={cn(lnCls(line), 'border-r border-border')}
        style={
          chrome
            ? {
                color: line.type === 'ctx' ? chrome.headerText : railColor(line.type),
                backgroundColor: chrome.headerBackground,
                borderRightColor: chrome.border,
              }
            : undefined
        }
      >
        {side === 'left' ? line.oldNo ?? '' : line.newNo ?? ''}
      </span>
      <span className={cn(
        'w-3.5 shrink-0 select-none text-center text-caption',
        side === 'left' && line.type === 'del' && 'text-diff-del',
        side === 'right' && line.type === 'add' && 'text-diff-add',
      )}>
        {sign(line.type)}
      </span>
      <LineContent spans={wdSpans} text={line.content} type={line.type} chrome={chrome} />
    </div>
  )
}

/** split 模式：每个 hunk 标题行横贯整宽，下方左右两栏各自横向滚动，超长行只在本栏内滚动。 */
function SplitHunks({
  hunks,
  path,
  sessionId,
  chrome,
  expandable,
  onExpandContext,
}: {
  hunks: DiffHunk[]
  path: string
  sessionId: string
  chrome: CodeBlockChromePalette | null
  expandable?: boolean
  onExpandContext?: (path: string, dir: 'up' | 'down') => void
}) {
  return (
    <>
      {hunks.map((h, i) => {
        const rows = buildSplitRows(h.lines)
        const isChange = (r: SplitRow) => r.left?.type !== 'ctx' || r.right?.type !== 'ctx'
        const runPos = changeRunPositions(rows, isChange)
        // T4 split word diff：仅等长配对行（左 del + 右 add）计算，超长行跳过
        const wdSpans = rows.map((r) =>
          r.left?.type === 'del' && r.right?.type === 'add' &&
          r.left.content.length <= WORD_DIFF_MAX_LEN && r.right.content.length <= WORD_DIFF_MAX_LEN
            ? wordDiff(r.left.content, r.right.content)
            : null,
        )
        return (
          <Fragment key={i}>
            <HunkHeader hunk={h} path={path} sessionId={sessionId} chrome={chrome} expandable={expandable} onExpandContext={onExpandContext} />
            <div className="flex">
              <div className="min-w-0 flex-1 overflow-x-auto">
                {rows.map((row, j) => (
                  <SplitCell key={j} line={row.left} side="left" chrome={chrome} blockPos={runPos[j]} wdSpans={wdSpans[j]?.del ?? null} />
                ))}
              </div>
              <div className="w-px shrink-0 bg-border" style={chrome ? { backgroundColor: chrome.border } : undefined} />
              <div className="min-w-0 flex-1 overflow-x-auto">
                {rows.map((row, j) => (
                  <SplitCell key={j} line={row.right} side="right" chrome={chrome} blockPos={runPos[j]} wdSpans={wdSpans[j]?.add ?? null} />
                ))}
              </div>
            </div>
          </Fragment>
        )
      })}
    </>
  )
}

/** T16：hunk 分布 minimap 色点（add=success / del=danger / 混合=warning）。 */
function hunkDotColor(h: DiffHunk): string {
  const adds = h.lines.some((l) => l.type === 'add')
  const dels = h.lines.some((l) => l.type === 'del')
  if (adds && dels) return 'rgb(var(--warning-rgb))'
  if (dels) return 'rgb(var(--danger-rgb))'
  return 'rgb(var(--success-rgb))'
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
  expandable,
  onExpandContext,
  narrow = false,
  onHunkJump,
  chrome,
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
  expandable?: boolean
  onExpandContext?: (path: string, dir: 'up' | 'down') => void
  /** T16：窄面板隐藏 minimap。 */
  narrow?: boolean
  onHunkJump?: (path: string, hunkIndex: number) => void
  chrome: CodeBlockChromePalette | null
}) {
  const { t } = useTranslation()
  const chip = STATUS_CHIP[file.status]
  const shown = expanded ?? file
  const isExpanded = !!expanded
  const isCollapsed = !!collapsed
  // T16：长文件（估算 >400 行）且 hunk ≥3 时显示分布 minimap；窄面板隐藏。
  const estLines =
    file.hunks.length > 0
      ? (file.hunks[file.hunks.length - 1]!.newStart ?? 0) +
        (file.hunks[file.hunks.length - 1]!.newLines ?? 0) -
        1
      : 0
  const showMinimap = !isCollapsed && !narrow && estLines > 400 && file.hunks.length >= 3
  const minimapHunks = showMinimap
    ? file.hunks
        .map((h, i) => ({ h, i }))
        .filter((_, k) =>
          file.hunks.length > 16 ? k % Math.ceil(file.hunks.length / 16) === 0 : true,
        )
    : []
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
        {showMinimap && (
          <span
            className="absolute inset-y-1 right-1 flex w-1 flex-col justify-between rounded-full bg-border/40"
            title={t('artifact.diffView.minimap')}
            data-testid="diff-minimap"
          >
            {minimapHunks.map(({ h, i }) => (
              <button
                key={i}
                type="button"
                className="h-1 w-full rounded-full"
                style={{ backgroundColor: hunkDotColor(h) }}
                title={`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`}
                onClick={() => onHunkJump?.(file.path, i)}
                data-testid={`diff-minimap-hunk-${i}`}
              />
            ))}
          </span>
        )}
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
          <span className="text-diff-add">+{file.additions}</span>
          <span className="text-diff-del">−{file.deletions}</span>
          <span className="flex items-center gap-0.5">
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
                <DropdownMenuItem onClick={() => void copyText(formatFileDiff(file))} data-testid="diff-file-copy-diff">
                  {t('artifact.changesView.copyFileDiff')}
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
          <div
            className={cn('font-mono text-meta', viewMode === 'unified' && 'overflow-x-auto')}
            data-testid="diff-code-area"
            style={
              chrome
                ? {
                    backgroundColor: chrome.background,
                    borderColor: chrome.border,
                    color: chrome.text,
                    // diff 主色按代码块明度选档（原型深浅色板），覆盖应用主题档；
                    // 深色代码块同步提升底色 alpha（深底上 13% 混合后近黑）
                    ...({
                      '--diff-add-rgb': chrome === CODE_BLOCK_CHROME.dark ? '76 175 80' : '47 125 64',
                      '--diff-del-rgb': chrome === CODE_BLOCK_CHROME.dark ? '255 82 82' : '198 59 59',
                      '--diff-bg-a': chrome === CODE_BLOCK_CHROME.dark ? '0.22' : '0.13',
                      '--diff-hover-a': chrome === CODE_BLOCK_CHROME.dark ? '0.28' : '0.19',
                    } as React.CSSProperties),
                  }
                : undefined
            }
          >
            {viewMode === 'split' ? (
              <SplitHunks hunks={shown.hunks} path={file.path} sessionId={sessionId} chrome={chrome} expandable={expandable} onExpandContext={onExpandContext} />
            ) : (
              shown.hunks.map((h, i) => (
                <HunkLines key={i} hunk={h} path={file.path} sessionId={sessionId} chrome={chrome} expandable={expandable} onExpandContext={onExpandContext} />
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

/** T7 汇总条：文件较多时（>6，由调用方判定）sticky 显示总数 + 折叠/展开/刷新 + 筛选。 */
function SummaryBar({
  total,
  adds,
  dels,
  filterQuery,
  onFilterChange,
  filterInputRef,
  narrow,
  onCollapseAll,
  onExpandAll,
  onRefresh,
  refreshing = false,
}: {
  total: number
  adds: number
  dels: number
  filterQuery: string
  onFilterChange: (q: string) => void
  filterInputRef?: Ref<HTMLInputElement>
  narrow: boolean
  onCollapseAll: () => void
  onExpandAll: () => void
  onRefresh: () => void
  refreshing?: boolean
}) {
  const { t } = useTranslation()
  const placeholder = t('artifact.changesView.filterPlaceholder')
  return (
    <div
      className="sticky top-0 z-[2] flex h-9 shrink-0 items-center gap-2 border-b border-border/70 bg-surface-subtle px-2.5"
      data-testid="diff-summarybar"
    >
      <span className="min-w-0 truncate text-caption font-medium text-ink-secondary">
        {t('artifact.changesView.summaryCount', { count: total })}
      </span>
      {!narrow && (
        <span className="shrink-0 font-mono text-caption tabular-nums">
          <span className="text-diff-add">+{adds}</span>
          <span className="text-diff-del"> −{dels}</span>
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          title={t('artifact.changesView.collapseAll')}
          onClick={onCollapseAll}
          className="inline-flex size-6 items-center justify-center rounded text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
          data-testid="diff-summary-collapse-all"
        >
          <ChevronsDownUp size={13} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title={t('artifact.changesView.expandAll')}
          onClick={onExpandAll}
          className="inline-flex size-6 items-center justify-center rounded text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
          data-testid="diff-summary-expand-all"
        >
          <ChevronsUpDown size={13} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title={t('artifact.changesView.refresh')}
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex size-6 items-center justify-center rounded text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink disabled:pointer-events-none disabled:opacity-60"
          data-testid="diff-summary-refresh"
        >
          {refreshing ? (
            <RefreshCw size={12} strokeWidth={1.75} className="animate-spin" />
          ) : (
            <RefreshCw size={12} strokeWidth={1.75} />
          )}
        </button>
      </span>
      <span className="relative flex shrink-0 items-center">
        <Search size={11} strokeWidth={1.75} className="pointer-events-none absolute left-1.5 text-ink-tertiary" />
        <input
          ref={filterInputRef}
          value={filterQuery}
          onChange={(e) => onFilterChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              onFilterChange('')
            }
          }}
          placeholder={narrow ? '' : placeholder}
          aria-label={placeholder}
          className={cn(
            'h-6 rounded-md border border-border/70 bg-surface pl-6 text-caption text-ink outline-none transition-[width] duration-chrome focus:border-ink/30',
            narrow ? 'w-7 px-0' : 'w-40',
          )}
          data-testid="diff-filter-input"
        />
        {filterQuery && (
          <button
            type="button"
            aria-label={t('artifact.changesView.filterClear')}
            onClick={() => onFilterChange('')}
            className="absolute right-1 inline-flex size-4 items-center justify-center rounded text-ink-tertiary hover:text-ink"
            data-testid="diff-filter-clear"
          >
            <X size={10} strokeWidth={2} />
          </button>
        )}
      </span>
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
  canExpandContext,
  onExpandContext,
  showSummary = false,
  filterQuery = '',
  onFilterChange,
  filterEmptyLabel,
  filterInputRef,
  narrow = false,
  onSummaryCollapseAll,
  onSummaryExpandAll,
  onSummaryRefresh,
  refreshing = false,
  groupByStatus = false,
  onHunkJump,
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
  /** T11：该文件当前上下文为数值档位时可展开上下文（'full' 无更多）。 */
  canExpandContext?: (path: string) => boolean
  onExpandContext?: (path: string, dir: 'up' | 'down') => void
  /** T7：Changes 场景专属——汇总条 + 筛选（Timeline/Diff 不传）。 */
  showSummary?: boolean
  filterQuery?: string
  onFilterChange?: (q: string) => void
  filterEmptyLabel?: string
  filterInputRef?: Ref<HTMLInputElement>
  narrow?: boolean
  /** T9：刷新在途 → 汇总条刷新按钮转圈。 */
  refreshing?: boolean
  onSummaryCollapseAll?: () => void
  onSummaryExpandAll?: () => void
  onSummaryRefresh?: () => void
  /** T17：按状态（A/M/D/R）分组显示，组间保持路径排序。 */
  groupByStatus?: boolean
  /** T16：minimap 色点点击 → 跳转到该 hunk（flash + 滚动）。 */
  onHunkJump?: (path: string, hunkIndex: number) => void
}) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const codeBlockTheme = useHipConfigStore((s) =>
    normalizeCodeBlockThemeId(s.config.codeBlock?.colorTheme),
  )
  const chrome = codeBlockTheme !== 'follow' ? CODE_BLOCK_CHROME[codeBlockTheme] : null

  // Stack sticky headers in expansion order: each expanded header's top offset
  // is the cumulative height of the expanded headers before it. Collapsed rows
  // lose stickiness entirely (no offset, no sticky class).
  // T7: 汇总条存在时作为基准（headers 在其下方堆叠，offset 从条高起算）。
  useLayoutEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const headers = root.querySelectorAll<HTMLElement>('[data-testid="diff-file-header"]')
    const bar = root.querySelector<HTMLElement>('[data-testid="diff-summarybar"]')
    let acc = bar?.offsetHeight ?? 0
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

  const summaryShown = showSummary
  const total = summary?.totalFiles ?? files.length
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      {summaryShown && onFilterChange && (
        <SummaryBar
          total={total}
          adds={summary?.totalAdditions ?? files.reduce((a, f) => a + f.additions, 0)}
          dels={summary?.totalDeletions ?? files.reduce((a, f) => a + f.deletions, 0)}
          filterQuery={filterQuery}
          onFilterChange={onFilterChange}
          filterInputRef={filterInputRef}
          narrow={narrow}
          onCollapseAll={onSummaryCollapseAll ?? (() => {})}
          onExpandAll={onSummaryExpandAll ?? (() => {})}
          onRefresh={onSummaryRefresh ?? (() => {})}
          refreshing={refreshing}
        />
      )}
      {/* T17：按状态分组时渲染组头（A/M/D/R），组内保持原顺序 */}
      {(groupByStatus
        ? (['added', 'modified', 'deleted', 'renamed'] as const)
            .map((status) => ({ status, groupFiles: files.filter((f) => f.status === status) }))
            .filter((g) => g.groupFiles.length > 0)
        : [{ status: null as DiffFileStatus | null, groupFiles: files }]
      ).map((g, gi) => (
        <Fragment key={g.status ?? 'all'}>
          {g.status && (
            <div
              className="flex items-center gap-1.5 bg-surface-muted/40 px-3 py-1 text-caption font-medium text-ink-tertiary"
              data-testid="diff-group-header"
            >
              <span className={cn('rounded-md px-1.5 py-px text-caption font-medium', STATUS_CHIP[g.status].cls)}>
                {STATUS_CHIP[g.status].letter}
              </span>
              {t(STATUS_CHIP[g.status].key)}
              <span className="tabular-nums">· {g.groupFiles.length}</span>
            </div>
          )}
          {g.groupFiles.map((file, i) => (
            <FileDiff
              key={`${file.path}-${gi}-${i}`}
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
              expandable={canExpandContext?.(file.path) ?? false}
              onExpandContext={onExpandContext}
              narrow={narrow}
              onHunkJump={onHunkJump}
              chrome={chrome}
            />
          ))}
        </Fragment>
      ))}
      {filterQuery && files.length === 0 && (
        <div className="px-3 py-6 text-center text-meta text-ink-tertiary" data-testid="diff-filter-empty">
          {filterEmptyLabel ?? t('artifact.changesView.filterEmpty')}
        </div>
      )}
      {!filterQuery && (summary?.totalFiles ?? 0) > files.length && (
        <div className="px-3 py-2 text-meta text-ink-tertiary">
          {t('artifact.diffView.moreFiles', { count: (summary!.totalFiles) - files.length })}
        </div>
      )}
    </div>
  )
}
