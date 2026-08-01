/**
 * Open a worktree row from sidebar / context menu (D10).
 * Resolves the bound session, or offers to create one when missing.
 */
import type { PermissionMode } from '@hip/protocol'
import { toast } from 'sonner'
import { selectSessionFromSidebar } from '@/components/layout/sidebarActions'
import { sessionService, useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import {
  collectNestedWorktreeSessionIds,
  extractParallelNestingHints,
  nestableCatalogPaths,
} from '@/lib/worktreeNesting'
import { resolveWorktreeOpenTarget } from '@/lib/worktreeOpenTarget'
import { useParallelStore } from '@/store/parallelStore'
import { useWorktreeStore } from '@/store/worktreeStore'

type Translate = (key: string, opts?: Record<string, string>) => string

export async function openWorktreeSession(input: {
  path: string
  hostSessionId: string
  isPrimary?: boolean
  slotSessionId?: string
  slotTaskId?: string
  boundSessionId?: string
  /** Host permission mode when creating a new session on this path. */
  hostPermissionMode?: PermissionMode
  t: Translate
}): Promise<void> {
  const sessions = useDomainStore.getState().sessions
  const runs = useParallelStore.getState().runs
  const catalogById = useWorktreeStore.getState().byId
  const hints = extractParallelNestingHints(runs)
  const catalogPaths = nestableCatalogPaths(Object.values(catalogById))
  const nestedSessionIds = collectNestedWorktreeSessionIds({
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      config: { cwd: s.config.cwd },
    })),
    slotSessionIds: hints.slotSessionIds,
    worktreePaths: [...hints.worktreePaths, ...catalogPaths],
  })

  const target = resolveWorktreeOpenTarget({
    path: input.path,
    hostSessionId: input.hostSessionId,
    isPrimary: input.isPrimary,
    slotSessionId: input.slotSessionId,
    slotTaskId: input.slotTaskId,
    boundSessionId: input.boundSessionId,
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      config: { cwd: s.config.cwd },
      status: s.status,
      updatedAtMs: s.updatedAtMs,
    })),
    nestedSessionIds,
  })

  if (target.kind === 'select') {
    await selectSessionFromSidebar(target.sessionId)
    return
  }

  if (target.reason === 'agent_task_only') {
    toast.message(input.t('chat.worktreeControl.agentTaskOnly'))
    return
  }

  const host = sessions.find((s) => s.id === input.hostSessionId)
  const permissionMode =
    input.hostPermissionMode ?? host?.config.permissionMode ?? DEFAULT_CONFIG.permissionMode

  toast.message(input.t('chat.worktreeControl.noSessionToast'), {
    action: {
      label: input.t('chat.worktreeControl.openHere'),
      onClick: () => {
        const id = sessionService.createSession({
          ...DEFAULT_CONFIG,
          surface: 'code',
          cwd: input.path,
          permissionMode,
        })
        void selectSessionFromSidebar(id)
      },
    },
  })
}
