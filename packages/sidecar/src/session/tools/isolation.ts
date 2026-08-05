import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import {
  createIsolation,
  discardIsolation,
  listIsolations,
  type IsolationInfo,
} from '../isolation.js'

export interface IsolationToolsCtx {
  repoPath?: string
  sessionId?: string
  onUpdated?: (rows: IsolationInfo[]) => void
}

export function buildIsolationTools(ctx: IsolationToolsCtx): StructuredToolInterface[] {
  const { repoPath, sessionId, onUpdated } = ctx
  if (!repoPath || !sessionId) return []

  const emit = () => onUpdated?.(listIsolations(repoPath))

  const create = tool(
    async ({ name, base_ref }) => {
      const r = createIsolation({
        repoPath,
        sessionId,
        name,
        baseRef: base_ref,
      })
      if (!r.ok || !r.worktree) return `Error: ${r.error ?? 'create failed'}`
      emit()
      return (
        `Created isolation worktree ${r.worktree.id}\n` +
        `path: ${r.worktree.path}\n` +
        `branch: ${r.worktree.branch}\n` +
        `Use this path as cwd for isolated subagents (task isolate=true).`
      )
    },
    {
      name: 'isolation_create',
      description:
        'Create a git worktree under ~/.hip/isolation for parallel edits without dirtying the main tree. ' +
        'Prefer task/task_batch with isolate=true for automatic setup.',
      schema: z.object({
        name: z.string().optional(),
        base_ref: z.string().optional().describe('Base ref (default HEAD)'),
      }),
    },
  )

  const discard = tool(
    async ({ worktree_id }) => {
      const r = discardIsolation({ repoPath, worktreeId: worktree_id })
      if (!r.ok) return `Error: ${r.error ?? 'discard failed'}`
      emit()
      return `Discarded isolation ${worktree_id}`
    },
    {
      name: 'isolation_discard',
      description: 'Remove an isolation worktree and its branch.',
      schema: z.object({ worktree_id: z.string() }),
    },
  )

  const list = tool(
    async () => {
      const rows = listIsolations(repoPath)
      if (rows.length === 0) return 'No isolation worktrees.'
      return rows.map((r) => `- ${r.id} ${r.branch} → ${r.path}`).join('\n')
    },
    {
      name: 'isolation_list',
      description: 'List isolation worktrees for this project.',
      schema: z.object({}),
    },
  )

  const revertPaths = tool(
    async ({ paths }) => {
      if (!paths.length) return 'Error: paths required'
      try {
        // worktree-only restore of paths from HEAD (safety: user asked to revert)
        const { execFileSync } = await import('node:child_process')
        execFileSync('git', ['checkout', 'HEAD', '--', ...paths], {
          cwd: repoPath,
          encoding: 'utf8',
          timeout: 60_000,
        })
        return `Reverted paths from HEAD:\n${paths.map((p) => `- ${p}`).join('\n')}`
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
    {
      name: 'revert_paths',
      description:
        'Restore listed paths in the current workspace to HEAD (worktree files only). ' +
        'Use after a bad edit; prefer git_checkpoint_revert for turn-level undo.',
      schema: z.object({
        paths: z.array(z.string()).min(1),
      }),
    },
  )

  return [create, discard, list, revertPaths]
}
