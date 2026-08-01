import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Folders, Copy, RefreshCw, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { ComposerChip } from '../ComposerChip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import {
  sessionService,
  useActiveSession,
  useSessions,
} from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import { selectSessionFromSidebar } from '@/components/layout/sidebarActions'
import { copyText } from '@/ipc/clipboard'
import { resolveWorktreeHostContext } from '@/lib/worktreeHostContext'
import {
  collectNestedWorktreeSessionIds,
  extractParallelNestingHints,
  nestableCatalogPaths,
  pathKey,
} from '@/lib/worktreeNesting'
import { resolveWorktreeOpenTarget } from '@/lib/worktreeOpenTarget'
import { isProjectPathBlocked } from '@/lib/projectPathGate'
import { surfaceOf } from '@/lib/sessions'
import { cn } from '@/lib/utils'
import {
  shortWorktreeLabel,
  slotsForHost,
  useParallelStore,
} from '@/store/parallelStore'
import { useProjectPathStore } from '@/store/projectPathStore'
import {
  catalogMinusParallelPaths,
  useWorktreeStore,
} from '@/store/worktreeStore'
import { WorktreeList, type WorktreeListRow } from './WorktreeList'
import { WorktreeCreateSingleModal } from './WorktreeCreateSingleModal'
import { openWorktreeDeleteDialog } from './worktreeDeleteDialogStore'

/** Composer control for isolated workspaces (browse / create single / switch / delete). */
export function WorktreeControl() {
  const { t } = useTranslation()
  const active = useActiveSession()
  const sessions = useSessions()
  const runs = useParallelStore((s) => s.runs)
  const catalogById = useWorktreeStore((s) => s.byId)
  const pathStatus = useProjectPathStore((s) => s.statusOf(active?.config.cwd))

  const [popoverOpen, setPopoverOpen] = useState(false)
  const [createSingleOpen, setCreateSingleOpen] = useState(false)
  /** D24: set only after create/op fails as non-git — never from empty list. */
  const [nonGit, setNonGit] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [listHydrated, setListHydrated] = useState(false)
  const listRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearListRefreshTimer = useCallback(() => {
    if (listRefreshTimerRef.current != null) {
      clearTimeout(listRefreshTimerRef.current)
      listRefreshTimerRef.current = null
    }
  }, [])

  const isCodeWithCwd =
    !!active && surfaceOf(active.config) === 'code' && !!active.config.cwd

  const projectBlocked = active
    ? isProjectPathBlocked(active.config, pathStatus)
    : false

  const catalog = useMemo(() => Object.values(catalogById), [catalogById])

  const hostCtx = useMemo(
    () =>
      resolveWorktreeHostContext({
        activeSession: active
          ? {
              id: active.id,
              config: { cwd: active.config.cwd, surface: active.config.surface },
            }
          : null,
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          config: { cwd: s.config.cwd },
        })),
        runs,
        catalog,
      }),
    [active, sessions, runs, catalog],
  )

  const hostSessionId = hostCtx.hostSessionId
  // Never enable create without a real main-tree path (avoid isolated cwd as baseCwd).
  const opsBaseCwd = hostCtx.primaryPath
  const createDisabled =
    hostCtx.unresolved || projectBlocked || nonGit || !opsBaseCwd || !hostSessionId

  // Clear non-git when host/cwd context changes (new project or resolved host).
  useEffect(() => {
    setNonGit(false)
  }, [hostSessionId, opsBaseCwd])

  const nestHints = useMemo(() => extractParallelNestingHints(runs), [runs])
  const nestedSessionIds = useMemo(
    () =>
      collectNestedWorktreeSessionIds({
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          config: { cwd: s.config.cwd },
        })),
        slotSessionIds: nestHints.slotSessionIds,
        worktreePaths: [...nestHints.worktreePaths, ...nestableCatalogPaths(catalog)],
      }),
    [sessions, nestHints, catalog],
  )

  const slots = useMemo(
    () => (hostSessionId ? slotsForHost(runs, hostSessionId) : []),
    [runs, hostSessionId],
  )
  const parallelPaths = useMemo(
    () => new Set(slots.map((s) => s.worktreePath).filter(Boolean)),
    [slots],
  )
  const catalogRows = useMemo(() => {
    if (!hostSessionId) return []
    return catalogMinusParallelPaths(
      useWorktreeStore.getState().catalogForHost(hostSessionId),
      parallelPaths,
    )
  }, [hostSessionId, parallelPaths, catalogById])

  const activeCwd = active?.config.cwd
  const listRows: WorktreeListRow[] = useMemo(() => {
    const activeCwdKey = activeCwd ? pathKey(activeCwd) : ''
    // Skip in-flight creates with no path yet (empty labels / no_session toasts).
    const readySlots = slots.filter(
      (slot) => !(slot.status === 'creating' && !slot.worktreePath),
    )
    const slotRows: WorktreeListRow[] = readySlots.map((slot) => {
      const sess = slot.sessionId
        ? sessions.find((s) => s.id === slot.sessionId)
        : undefined
      const key = slot.sessionId || slot.taskId || `${slot.runId}-${slot.index}`
      return {
        kind: 'slot',
        key,
        path: slot.worktreePath,
        branch: slot.branch,
        label: sess?.title || slot.branch || `P${slot.index}`,
        sessionId: slot.sessionId || undefined,
        taskId: slot.taskId,
        runId: slot.runId,
        status: slot.status,
        isActive: !!(slot.worktreePath && pathKey(slot.worktreePath) === activeCwdKey),
      }
    })
    const catRows: WorktreeListRow[] = catalogRows.map((row) => ({
      kind: 'catalog',
      key: row.id,
      path: row.path,
      branch: row.branch,
      label: row.isPrimary
        ? t('chat.worktreeControl.mainWorkspace')
        : row.label || row.branch || shortWorktreeLabel(row.path, row.branch),
      worktreeId: row.id,
      isActive: pathKey(row.path) === activeCwdKey,
      row,
    }))
    return [...slotRows, ...catRows]
  }, [slots, catalogRows, sessions, activeCwd, t])

  // Badge / empty state count real isolations; the primary row never counts.
  const isolationCount = listRows.filter(
    (r) => !(r.kind === 'catalog' && r.row.isPrimary),
  ).length
  const empty = listHydrated && !listLoading && isolationCount === 0

  const chipLabel = useMemo(() => {
    if (!hostCtx.isOnIsolated) return t('chat.worktreeControl.mainWorkspace')
    const activePath = hostCtx.activeWorktreePath || activeCwd
    const match = listRows.find(
      (r) => activePath && pathKey(r.path) === pathKey(activePath),
    )
    if (match) return match.label
    const cat = catalog.find(
      (c) => activePath && pathKey(c.path) === pathKey(activePath),
    )
    return (
      cat?.label ||
      cat?.branch ||
      shortWorktreeLabel(activePath || '', cat?.branch || '')
    )
  }, [hostCtx.isOnIsolated, hostCtx.activeWorktreePath, activeCwd, listRows, catalog, t])

  const refreshList = useCallback(() => {
    if (!hostSessionId || hostCtx.unresolved) return
    clearListRefreshTimer()
    setListLoading(true)
    // If we already have rows, treat as hydrated so empty CTA does not flash mid-refresh.
    if (isolationCount > 0) setListHydrated(true)
    sessionService.requestWorktreeList(hostSessionId)
    listRefreshTimerRef.current = setTimeout(() => {
      listRefreshTimerRef.current = null
      setListLoading(false)
      setListHydrated(true)
    }, 400)
  }, [hostSessionId, hostCtx.unresolved, clearListRefreshTimer, isolationCount])

  useEffect(() => {
    if (!popoverOpen) {
      clearListRefreshTimer()
      return
    }
    if (hostSessionId && !hostCtx.unresolved) {
      refreshList()
    } else {
      setListHydrated(true)
      setListLoading(false)
    }
    return () => {
      clearListRefreshTimer()
    }
  }, [popoverOpen, hostSessionId, hostCtx.unresolved, refreshList, clearListRefreshTimer])

  // Best-effort: store updates after list:result while a refresh is in flight.
  useEffect(() => {
    if (!listLoading || !popoverOpen) return
    if (isolationCount > 0) {
      setListHydrated(true)
    }
  }, [catalogById, isolationCount, listLoading, popoverOpen])

  const openCreateSingle = useCallback(() => {
    if (createDisabled || !hostSessionId) return
    setPopoverOpen(false)
    // Close popover before Modal (D17 — avoid pointer-events stacking).
    window.setTimeout(() => setCreateSingleOpen(true), 0)
  }, [createDisabled, hostSessionId])

  const handleOpenRow = useCallback(
    async (row: WorktreeListRow) => {
      if (!active) return
      const target = resolveWorktreeOpenTarget({
        path: row.path,
        hostSessionId,
        isPrimary: row.kind === 'catalog' ? row.row.isPrimary : false,
        slotSessionId: row.kind === 'slot' ? row.sessionId : undefined,
        slotTaskId: row.kind === 'slot' ? row.taskId : undefined,
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          config: { cwd: s.config.cwd },
          status: s.status,
          updatedAtMs: s.updatedAtMs,
        })),
        nestedSessionIds,
      })

      setPopoverOpen(false)

      if (target.kind === 'select') {
        await selectSessionFromSidebar(target.sessionId)
        return
      }
      if (target.reason === 'agent_task_only') {
        toast.message(t('chat.worktreeControl.agentTaskOnly'))
        return
      }
      toast.message(t('chat.worktreeControl.noSessionToast'), {
        action: {
          label: t('chat.worktreeControl.openHere'),
          onClick: () => {
            const id = sessionService.createSession({
              ...DEFAULT_CONFIG,
              surface: 'code',
              cwd: row.path,
              permissionMode: active.config.permissionMode ?? 'edit',
            })
            void selectSessionFromSidebar(id)
          },
        },
      })
    },
    [active, hostSessionId, sessions, nestedSessionIds, t],
  )

  const handleCopyPath = useCallback(
    (path: string) => {
      void copyText(path).then(
        (ok) => {
          if (ok) toast.success(t('chat.worktreeControl.pathCopied'))
          else toast.error(t('chat.worktreeControl.copyFailed'))
        },
        () => toast.error(t('chat.worktreeControl.copyFailed')),
      )
    },
    [t],
  )

  const handleDeleteRow = useCallback(
    (row: WorktreeListRow) => {
      if (!hostSessionId || hostCtx.unresolved) return
      // Close popover before Modal (D17 stacking / pointer-events).
      setPopoverOpen(false)
      openWorktreeDeleteDialog({
        hostSessionId,
        worktreePath: row.path,
        label: row.label,
        branch: row.branch || undefined,
        slotSessionId: row.kind === 'slot' ? row.sessionId : undefined,
        reason: 'worktree-control',
      })
    },
    [hostSessionId, hostCtx.unresolved],
  )

  // D25: Code-only; hide without cwd
  if (!isCodeWithCwd || !active) return null

  const chipTitle = projectBlocked
    ? t('chat.worktreeControl.pathBlocked')
    : `${active.config.cwd}\n${t('chat.worktreeControl.chipPurpose')}`

  const currentLabel = hostCtx.isOnIsolated
    ? chipLabel
    : t('chat.worktreeControl.mainWorkspace')
  const currentBranch = hostCtx.isOnIsolated
    ? listRows.find(
        (r) =>
          hostCtx.activeWorktreePath &&
          pathKey(r.path) === pathKey(hostCtx.activeWorktreePath),
      )?.branch
    : catalog.find((c) => c.isPrimary)?.branch

  const displayPath =
    hostCtx.isOnIsolated && hostCtx.activeWorktreePath
      ? hostCtx.activeWorktreePath
      : hostCtx.primaryPath || active.config.cwd

  return (
    <>
      <Popover
        open={popoverOpen}
        onOpenChange={(next) => {
          if (projectBlocked) return
          setPopoverOpen(next)
        }}
        modal={false}
      >
        <PopoverTrigger asChild>
          <ComposerChip
            type="button"
            disabled={projectBlocked}
            title={chipTitle}
            aria-label={t('chat.worktreeControl.chipAria')}
            aria-haspopup="dialog"
            aria-expanded={popoverOpen}
            data-testid="worktree-control-chip"
            data-worktree-control-chip=""
            size="sm"
            className={cn(popoverOpen && 'bg-state-active text-ink')}
          >
            <Folders size={11} strokeWidth={1.75} className="shrink-0 opacity-80" aria-hidden />
            <span className="max-w-[120px] truncate">{chipLabel}</span>
            {isolationCount > 0 ? (
              <span
                className="rounded-md bg-surface-muted px-1.5 py-px text-caption font-medium text-ink-secondary"
                data-testid="worktree-control-badge"
              >
                {isolationCount}
              </span>
            ) : null}
          </ComposerChip>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          data-testid="worktree-control-popover"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex flex-col text-body">
            <div className="border-b border-border px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-meta text-ink-tertiary">
                <span>{t('chat.worktreeControl.current')}</span>
                <span className="text-ink">·</span>
                <span className="truncate font-medium text-ink">{currentLabel}</span>
                {currentBranch ? (
                  <>
                    <span className="text-ink-tertiary">·</span>
                    <span className="truncate text-ink-secondary">{currentBranch}</span>
                  </>
                ) : null}
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <span
                  className="min-w-0 flex-1 truncate text-caption text-ink-tertiary"
                  title={displayPath}
                >
                  {displayPath}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-ink-tertiary hover:bg-state-hover hover:text-ink"
                  title={t('chat.worktreeControl.copyPath')}
                  data-testid="worktree-control-copy-current"
                  onClick={() => handleCopyPath(displayPath || '')}
                >
                  <Copy size={12} />
                </button>
              </div>
            </div>

            {hostCtx.unresolved ? (
              <div
                className="border-b border-border bg-warning/10 px-3 py-2 text-meta text-ink"
                data-testid="worktree-control-unresolved"
                role="status"
              >
                {t('chat.worktreeControl.unresolvedBanner')}
              </div>
            ) : null}

            {nonGit && !hostCtx.unresolved ? (
              <div
                className="border-b border-border bg-warning/10 px-3 py-2 text-meta text-ink"
                data-testid="worktree-control-non-git"
                role="status"
              >
                {t('chat.worktreeControl.nonGitBanner')}
              </div>
            ) : null}

            <div className="border-b border-border">
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-meta font-medium text-ink-secondary">
                  {t('chat.worktreeControl.listTitle')}
                </span>
                <button
                  type="button"
                  disabled={hostCtx.unresolved || listLoading}
                  title={t('chat.worktreeControl.refresh')}
                  data-testid="worktree-control-refresh"
                  onClick={() => refreshList()}
                  className={cn(
                    'rounded p-1 text-ink-tertiary hover:bg-state-hover hover:text-ink',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                >
                  <RefreshCw size={12} className={cn(listLoading && 'animate-spin')} />
                </button>
              </div>
              <WorktreeList
                rows={listRows}
                loading={listLoading && !listHydrated}
                empty={empty}
                onOpenRow={(row) => void handleOpenRow(row)}
                onCopyPath={handleCopyPath}
                onDeleteRow={handleDeleteRow}
                onOpenCreateSingle={openCreateSingle}
                createDisabled={createDisabled}
                deleteDisabled={hostCtx.unresolved || !hostSessionId}
              />
            </div>

            <div className="flex flex-col gap-0.5 border-b border-border p-1.5">
              <button
                type="button"
                disabled={createDisabled}
                data-testid="worktree-control-create-single"
                onClick={openCreateSingle}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-meta text-ink',
                  'hover:bg-state-hover',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <Plus size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
                {t('chat.worktreeControl.createSingle')}
              </button>
            </div>

            <div className="px-3 py-2 text-caption leading-snug text-ink-tertiary">
              {t('chat.worktreeControl.footerHint')}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {hostSessionId ? (
        <WorktreeCreateSingleModal
          open={createSingleOpen}
          onOpenChange={setCreateSingleOpen}
          hostSessionId={hostSessionId}
          onNonGitError={() => setNonGit(true)}
        />
      ) : null}
    </>
  )
}
