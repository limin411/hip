import { useTranslation } from 'react-i18next'
import { GitBranch, MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { cn } from '@/lib/utils'
import { shortWorktreeLabel } from '@/store/parallelStore'
import type { CatalogWorktree } from '@/store/worktreeStore'
import type { ParallelSlot } from '@/store/parallelStore'

export type WorktreeListRow =
  | {
      kind: 'slot'
      key: string
      path: string
      branch: string
      label: string
      sessionId?: string
      taskId?: string
      runId: string
      status?: ParallelSlot['status']
      isActive: boolean
    }
  | {
      kind: 'catalog'
      key: string
      path: string
      branch: string
      label: string
      worktreeId: string
      isActive: boolean
      row: CatalogWorktree
    }

interface WorktreeListProps {
  rows: WorktreeListRow[]
  loading: boolean
  empty: boolean
  onOpenRow: (row: WorktreeListRow) => void
  onCopyPath: (path: string) => void
  onDeleteRow?: (row: WorktreeListRow) => void
  onOpenCreateSingle: () => void
  createDisabled: boolean
  /** When true, delete menu item is disabled (e.g. unresolved host). */
  deleteDisabled?: boolean
}

export function WorktreeList({
  rows,
  loading,
  empty,
  onOpenRow,
  onCopyPath,
  onDeleteRow,
  onOpenCreateSingle,
  createDisabled,
  deleteDisabled = false,
}: WorktreeListProps) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div
        className="space-y-2 px-3 py-2"
        data-testid="worktree-control-list-loading"
        aria-busy="true"
      >
        <div className="h-8 animate-pulse rounded-md bg-surface-muted" />
        <div className="h-8 animate-pulse rounded-md bg-surface-muted" />
      </div>
    )
  }

  if (empty) {
    return (
      <div
        className="px-3 py-3 text-center"
        data-testid="worktree-control-empty"
      >
        <p className="text-meta text-ink-secondary">
          {t('chat.worktreeControl.emptyTitle')}
        </p>
        <button
          type="button"
          disabled={createDisabled}
          data-testid="worktree-control-empty-cta"
          onClick={onOpenCreateSingle}
          className={cn(
            'mt-2 text-meta font-medium text-accent hover:text-accent-strong',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {t('chat.worktreeControl.createSingle')}
        </button>
      </div>
    )
  }

  return (
    <ul
      className="m-0 max-h-52 list-none overflow-y-auto p-0"
      role="listbox"
      data-testid="worktree-control-list"
      aria-label={t('chat.worktreeControl.listTitle')}
    >
      {rows.map((row) => {
        const pathLabel = shortWorktreeLabel(row.path, row.branch)
        return (
          <li key={row.key} className="m-0 p-0" role="option" aria-selected={row.isActive}>
            <div
              className={cn(
                'flex w-full items-start gap-1 px-2 py-1.5',
                row.isActive ? 'bg-accent/10' : 'hover:bg-state-hover',
              )}
            >
              <button
                type="button"
                data-testid={`worktree-control-row-${row.key}`}
                title={row.path}
                onClick={() => onOpenRow(row)}
                className={cn(
                  'flex min-w-0 flex-1 items-start gap-2 rounded-md px-1 py-0.5 text-left',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                )}
              >
                <GitBranch
                  size={12}
                  className="mt-0.5 shrink-0 text-ink-tertiary"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-ink">
                    {row.label}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-ink-tertiary">
                    {pathLabel}
                  </span>
                </span>
              </button>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    data-testid={`worktree-control-row-menu-${row.key}`}
                    className={cn(
                      'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded text-ink-tertiary',
                      'hover:bg-state-hover hover:text-ink',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                    )}
                    aria-label={t('chat.worktreeControl.rowMenu')}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  <DropdownMenuItem
                    onSelect={() => onOpenRow(row)}
                    data-testid={`worktree-control-open-${row.key}`}
                  >
                    {t('chat.worktreeControl.openChat')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => onCopyPath(row.path)}
                    data-testid={`worktree-control-copy-${row.key}`}
                  >
                    {t('chat.worktreeControl.copyPath')}
                  </DropdownMenuItem>
                  {onDeleteRow ? (
                    <DropdownMenuItem
                      disabled={deleteDisabled}
                      onSelect={() => {
                        if (deleteDisabled) return
                        onDeleteRow(row)
                      }}
                      data-testid={`worktree-control-delete-${row.key}`}
                      className="text-danger focus:text-danger"
                    >
                      {t('chat.worktreeControl.delete.menuItem')}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
