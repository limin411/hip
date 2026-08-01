import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Check, ChevronDown, Loader2, AlertTriangle, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { useParallelStore } from '@/store/parallelStore'
import { useWorktreeStore } from '@/store/worktreeStore'
import { resolveWorktreeHostContext } from '@/lib/worktreeHostContext'
import { pathKey } from '@/lib/worktreeNesting'
import { parseCheckedOutPath } from '@/lib/branchSwitchError'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ComposerChip } from '@/components/chat/ComposerChip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@/components/ui/DropdownMenu'

/** Panel-header current-branch chip + branch dropdown + a switch-confirm modal. */
export function BranchSwitcher() {
  const { t } = useTranslation()
  const sessionId = useDomainStore((s) => s.activeSessionId)
  const sessions = useDomainStore((s) => s.sessions)
  const active = sessions.find((s) => s.id === sessionId)
  const activeCwd = active?.config.cwd
  const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF

  // C1: a session (this one or a parallel slot) is running in the same checkout —
  // `git switch` would rewrite files under it, so block the confirm.
  const runningInCheckout = useMemo(() => {
    if (!sessionId || !activeCwd) return false
    return sessions.some(
      (s) =>
        s.status === 'running' &&
        s.config.cwd &&
        pathKey(s.config.cwd) === pathKey(activeCwd),
    )
  }, [sessions, sessionId, activeCwd])

  // C3: inside an isolated worktree the chip's git ops act on that checkout —
  // label it so the scope is explicit (same host resolution as WorktreeControl).
  const runs = useParallelStore((s) => s.runs)
  const catalogById = useWorktreeStore((s) => s.byId)
  const hostCtx = useMemo(
    () =>
      resolveWorktreeHostContext({
        activeSession: active
          ? { id: active.id, config: { cwd: active.config.cwd, surface: active.config.surface } }
          : null,
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          config: { cwd: s.config.cwd },
        })),
        runs,
        catalog: Object.values(catalogById),
      }),
    [active, sessions, runs, catalogById],
  )
  const isIsolated = hostCtx.isOnIsolated

  const [pending, setPending] = useState<string | null>(null) // branch awaiting confirm
  const [switching, setSwitching] = useState(false)
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  // Pull the branch list on mount / session change so the chip + dropdown are populated.
  useEffect(() => {
    if (sessionId) sessionService.requestBranches(sessionId)
  }, [sessionId])

  // Clear the switching spinner once the current branch reflects the pending target.
  useEffect(() => {
    if (switching && pending && diff.currentBranch === pending) {
      setSwitching(false)
      setPending(null)
    }
  }, [switching, pending, diff.currentBranch])

  // On a FAILED switch (e.g. dirty tree) the service records switchError → clear the spinner so the
  // modal is no longer stuck; the error stays visible until the user dismisses or retries.
  useEffect(() => {
    if (switching && diff.switchError) setSwitching(false)
  }, [switching, diff.switchError])

  // Reset all transient confirm state. ALWAYS reachable (Cancel / ESC / overlay / X) so a failed or
  // hung switch can never brick the modal.
  const closeConfirm = useCallback(() => {
    setPending(null)
    setSwitching(false)
    if (sessionId) useDiffStore.getState().setSwitchError(sessionId, null)
  }, [sessionId])

  const branches = diff.branches
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return branches
    return branches.filter((b) => b.name.toLowerCase().includes(q))
  }, [branches, query])

  const onMenuOpenChange = (open: boolean) => {
    setMenuOpen(open)
    if (!open) setQuery('')
  }

  if (!sessionId) return null
  const current = diff.currentBranch
  const checkedOutPath = diff.switchError ? parseCheckedOutPath(diff.switchError) : null

  return (
    <>
      {/* modal={false}: this modal dropdown + the switch-confirm Modal its item opens both lock
          `body { pointer-events: none }`; stacking them leaves the lock stuck after the dialog
          closes (whole app unclickable). Same fix/pattern as AgentCard.tsx. */}
      <DropdownMenu modal={false} open={menuOpen} onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <ComposerChip
            type="button"
            data-testid="branch-chip"
            title={t('artifact.branch.current')}
            size="sm"
          >
            <GitBranch size={11} strokeWidth={1.75} className="shrink-0" />
            <span className="max-w-[120px] truncate">
              {current ?? t('artifact.branch.noBranch')}
              {isIsolated ? ` · ${t('artifact.branch.inWorktree')}` : ''}
            </span>
            <ChevronDown size={11} strokeWidth={1.75} className="shrink-0 opacity-60" />
          </ComposerChip>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="flex w-64 flex-col p-0"
          data-testid="branch-menu"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuLabel className="px-2.5 pt-2 pb-1">
            {t('artifact.branch.switchTitle')}
          </DropdownMenuLabel>
          <div className="border-b border-border px-2 pb-2">
            <div className="relative">
              <Search
                size={14}
                strokeWidth={1.75}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-tertiary"
                aria-hidden
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('artifact.branch.searchPlaceholder')}
                data-testid="branch-search"
                // Keep focus in the field; don't let menu keyboard nav steal every keystroke.
                onKeyDown={(e) => e.stopPropagation()}
                className="h-8 w-full rounded-sm border border-border bg-surface py-1 pl-7 pr-2 text-meta text-ink outline-none transition-[border-color,box-shadow] duration-chrome placeholder:text-ink-tertiary focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/10"
              />
            </div>
          </div>
          <div
            className="max-h-56 overflow-y-auto overscroll-contain p-1"
            data-testid="branch-list"
          >
            {filtered.length === 0 ? (
              <div
                className="px-2.5 py-4 text-center text-meta text-ink-tertiary"
                data-testid="branch-empty"
                role="status"
              >
                {branches.length === 0
                  ? t('artifact.branch.empty')
                  : t('artifact.branch.noMatch')}
              </div>
            ) : (
              filtered.map((b) => (
                <DropdownMenuItem
                  key={b.name}
                  data-testid="branch-option"
                  onSelect={() => {
                    if (!b.current) setPending(b.name)
                  }}
                  className="justify-between text-body"
                >
                  <span className="min-w-0 truncate" title={b.name}>
                    {b.name}
                  </span>
                  {b.current && <Check size={14} className="shrink-0 text-accent" />}
                </DropdownMenuItem>
              ))
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Modal
        open={!!pending}
        onOpenChange={(o) => {
          if (!o) closeConfirm()
        }}
        title={t('artifact.branch.switchConfirmTitle', { branch: pending ?? '' })}
      >
        <div className="flex flex-col gap-4 p-5">
          <p className="text-body text-ink-secondary">{t('artifact.branch.switchConfirmBody')}</p>
          {diff.switchError && (
            <div
              data-testid="branch-switch-error"
              className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 p-2 text-meta text-ink"
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
              {checkedOutPath ? (
                <span className="min-w-0 break-words">
                  {t('artifact.branch.switchCheckedOut', { path: checkedOutPath })}
                </span>
              ) : (
                <span className="min-w-0 break-words">
                  {t('artifact.branch.switchFailed')}
                  {diff.switchError ? `: ${diff.switchError}` : ''}
                </span>
              )}
            </div>
          )}
          {runningInCheckout && (
            <div
              data-testid="branch-switch-running-warning"
              className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-meta text-ink"
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
              <span className="min-w-0 break-words">
                {t('artifact.branch.switchBlockedRunning')}
              </span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            {/* Cancel is ALWAYS enabled so a failed/hung switch can be backed out of. */}
            <Button variant="ghost" size="sm" onClick={closeConfirm}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              disabled={switching || runningInCheckout}
              data-testid="branch-switch-confirm"
              onClick={() => {
                if (pending) {
                  useDiffStore.getState().setSwitchError(sessionId, null)
                  setSwitching(true)
                  sessionService.switchBranch(sessionId, pending)
                }
              }}
            >
              {switching && <Loader2 size={13} className={cn('mr-1.5 animate-spin')} />}
              {switching
                ? t('artifact.branch.switching')
                : diff.switchError
                  ? t('artifact.branch.switchRetry')
                  : t('artifact.branch.switchConfirmAction')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
