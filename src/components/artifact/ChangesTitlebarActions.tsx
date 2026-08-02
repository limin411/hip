import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpFromLine, Check, GitCommitHorizontal, MoreHorizontal, Sparkles } from 'lucide-react'
import type { DiffBase } from '@hip/protocol'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { useUiStore } from '@/store/uiStore'
import { insertComposerText } from '@/components/command-palette/composerBridge'
import { Button } from '@/components/ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { sumDiffStats } from './panelContextSlotModel'
import { ChangesCommitDialog } from './ChangesCommitDialog'

/**
 * Changes tab titlebar chrome: identity + baseline + Review + ⋯.
 * Lives in PanelContextSlot so ChangesView has no second toolbar row.
 */
export function ChangesTitlebarActions() {
  const { t } = useTranslation()
  const sessionId = useDomainStore((s) => s.activeSessionId)
  const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF
  const diffViewMode = useUiStore((s) => s.diffViewMode)
  const setDiffViewMode = useUiStore((s) => s.setDiffViewMode)
  const ignoreWhitespace = useUiStore((s) => s.ignoreWhitespace)
  const setIgnoreWhitespace = useUiStore((s) => s.setIgnoreWhitespace)
  const running = useDomainStore((s) => {
    if (!s.activeSessionId) return false
    return s.sessions.find((x) => x.id === s.activeSessionId)?.status === 'running'
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const [commitOpen, setCommitOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    // Slot is ~full rail minus Tab▾/collapse; match ChangesView's former <420 rail rule.
    const measure = () => setNarrow(el.getBoundingClientRect().width < 360)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const stats = sumDiffStats(diff.files)
  const hasUncommitted = stats.fileCount > 0

  const setBase = (base: DiffBase) => {
    if (!sessionId) return
    if (base === 'session-start' && !diff.hasSessionStart) return
    useDiffStore.getState().setBase(sessionId, base)
    sessionService.requestDiff(sessionId, base)
  }

  const reviewFiles = () => {
    const baseLabel =
      diff.base === 'session-start'
        ? t('artifact.diffView.baseSession')
        : t('artifact.diffView.baseHead')
    const prompt = t('artifact.changesView.reviewPrompt', {
      files: diff.files.map((f) => f.path).join('\n'),
      base: baseLabel,
    })
    if (insertComposerText(prompt)) {
      toast.success(t('artifact.changesView.reviewInjected'))
    } else {
      toast.error(t('artifact.changesView.reviewNoComposer'))
    }
  }

  const toggleIgnoreWhitespace = () => {
    const next = !ignoreWhitespace
    setIgnoreWhitespace(next)
    if (sessionId) sessionService.requestDiff(sessionId, undefined, next)
  }

  const setAllCollapsed = (value: boolean) => {
    if (!sessionId) return
    const next: Record<string, boolean> = {}
    for (const f of diff.files) next[f.path] = value
    useDiffStore.getState().setCollapsed(sessionId, next)
  }

  const refresh = () => {
    if (!sessionId) return
    sessionService.requestDiff(sessionId)
  }

  const openCommit = () => {
    if (!sessionId || running || !hasUncommitted) return
    sessionService.requestCheckpoints(sessionId)
    setCommitOpen(true)
  }

  const confirmCommit = (prompt: string) => {
    setCommitOpen(false)
    sessionService.sendMessage(prompt)
    toast.success(t('artifact.changesView.commitStarted'))
  }

  const pushBranch = () => {
    if (!sessionId || running) return
    sessionService.requestCheckpoints(sessionId)
    const branch =
      diff.currentBranch?.trim() || t('artifact.changesView.commitBranchUnknown')
    const prompt = t('artifact.changesView.pushPrompt', { branch })
    sessionService.sendMessage(prompt)
    toast.success(t('artifact.changesView.pushStarted'))
  }

  const label =
    stats.fileCount > 0
      ? t('artifact.panelSlot.uncommitted', { count: stats.fileCount })
      : t('artifact.panelSlot.uncommittedEmpty')

  return (
    <div
      ref={rootRef}
      className="flex min-w-0 flex-1 items-center gap-0.5"
      data-tauri-drag-region="false"
      data-testid="panel-context-slot"
    >
      <span
        className="flex min-w-0 max-w-[9rem] items-center gap-1 px-1 text-meta text-ink-secondary sm:max-w-[12rem]"
        data-testid="slot-changes-identity"
      >
        <span className="min-w-0 truncate">{label}</span>
        {stats.fileCount > 0 && !narrow && (
          <span className="shrink-0 tabular-nums text-ink-tertiary">
            <span className="text-success">+{stats.additions}</span>
            <span className="text-danger"> −{stats.deletions}</span>
          </span>
        )}
      </span>

      <div
        role="tablist"
        aria-label={t('artifact.changesView.baseLabel')}
        data-testid="changes-base-toggle"
        className="inline-flex shrink-0 items-center rounded-md border border-border/70 p-px"
      >
        {(
          [
            ['session-start', t('artifact.diffView.baseSession')],
            ['head', t('artifact.diffView.baseHead')],
          ] as const
        ).map(([base, baseLabel]) => {
          const selected = diff.base === base
          const disabled = base === 'session-start' && !diff.hasSessionStart
          return (
            <button
              key={base}
              type="button"
              role="tab"
              aria-selected={selected}
              disabled={disabled}
              title={disabled ? t('artifact.changesView.noSessionStart') : baseLabel}
              data-base={base}
              data-testid={`changes-base-${base}`}
              onClick={() => setBase(base)}
              className={cn(
                'rounded-[3px] px-1.5 py-0.5 text-caption font-medium transition-colors duration-chrome',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                'disabled:cursor-not-allowed disabled:opacity-40',
                selected
                  ? 'bg-surface bg-surface-subtle text-ink'
                  : 'text-ink-tertiary hover:text-ink-secondary',
                narrow && 'max-w-[4.5rem] truncate',
              )}
            >
              {narrow ? (base === 'head' ? 'HEAD' : 'S') : baseLabel}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-meta font-medium',
          'bg-btn-primary text-on-btn-primary transition-colors duration-chrome',
          'hover:bg-btn-primary-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
          'disabled:pointer-events-none disabled:opacity-40',
          narrow && 'size-7 justify-center px-0',
        )}
        disabled={running || !hasUncommitted}
        title={
          running
            ? t('artifact.changesView.reviewRunningDisabled')
            : !hasUncommitted
              ? t('artifact.diffView.clean')
              : t('artifact.changesView.review')
        }
        onClick={reviewFiles}
        data-testid="changes-review"
      >
        <Sparkles size={12} strokeWidth={1.75} />
        {!narrow && t('artifact.changesView.review')}
      </button>

      <button
        type="button"
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border border-border px-2 text-meta font-medium',
          'bg-surface text-ink transition-colors duration-chrome',
          'hover:bg-state-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
          'disabled:pointer-events-none disabled:opacity-40',
          narrow && 'size-7 justify-center px-0',
        )}
        disabled={running || !hasUncommitted}
        title={
          running
            ? t('artifact.changesView.commitRunningDisabled')
            : !hasUncommitted
              ? t('artifact.diffView.clean')
              : t('artifact.changesView.commit')
        }
        onClick={openCommit}
        data-testid="changes-commit"
      >
        <GitCommitHorizontal size={12} strokeWidth={1.75} />
        {!narrow && t('artifact.changesView.commit')}
      </button>

      <button
        type="button"
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border border-border px-2 text-meta font-medium',
          'bg-surface text-ink transition-colors duration-chrome',
          'hover:bg-state-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
          'disabled:pointer-events-none disabled:opacity-40',
          narrow && 'size-7 justify-center px-0',
        )}
        disabled={running}
        title={
          running
            ? t('artifact.changesView.pushRunningDisabled')
            : t('artifact.changesView.push')
        }
        onClick={pushBranch}
        data-testid="changes-push"
      >
        <ArrowUpFromLine size={12} strokeWidth={1.75} />
        {!narrow && t('artifact.changesView.push')}
      </button>

      <ChangesCommitDialog
        open={commitOpen}
        branch={diff.currentBranch}
        uncommittedPaths={diff.files.map((f) => f.path)}
        onOpenChange={setCommitOpen}
        onConfirm={confirmCommit}
      />

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={t('artifact.changesView.toolbarMenu')}
            data-testid="changes-toolbar-menu"
          >
            <MoreHorizontal size={15} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" data-testid="changes-toolbar-menu-content">
          <DropdownMenuItem
            onClick={toggleIgnoreWhitespace}
            data-testid="changes-menu-ignore-ws"
            className="justify-between gap-4"
          >
            <span>{t('artifact.changesView.ignoreWhitespace')}</span>
            {ignoreWhitespace ? (
              <Check size={13} className="shrink-0 text-accent" aria-hidden />
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuRadioGroup
            value={diffViewMode}
            onValueChange={(v) => setDiffViewMode(v as 'unified' | 'split')}
          >
            <DropdownMenuRadioItem value="unified" data-testid="changes-menu-unified">
              {t('artifact.diffView.viewUnified')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="split"
              data-testid="changes-menu-split"
              disabled={narrow}
              title={narrow ? t('artifact.changesView.panelTooNarrow') : undefined}
            >
              {t('artifact.diffView.viewSplit')}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setAllCollapsed(true)} data-testid="changes-menu-collapse-all">
            {t('artifact.changesView.collapseAll')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setAllCollapsed(false)} data-testid="changes-menu-expand-all">
            {t('artifact.changesView.expandAll')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={refresh} data-testid="changes-menu-refresh">
            {t('artifact.changesView.refresh')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="min-h-full min-w-2 flex-1" data-tauri-drag-region />
    </div>
  )
}
