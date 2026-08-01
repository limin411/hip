import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { Checkpoint } from '@hip/protocol'

export interface CheckpointToolsCtx {
  cwd?: string
  sessionId?: string
  /** Session checkpoints (newest-first) from the sidecar store. */
  list?: () => Promise<Checkpoint[]>
  /**
   * Exact worktree restore to a checkpoint (safety checkpoint + worktree-only,
   * same path as the removed Timeline panel revert). Emits checkpoint:created.
   */
  revert?: (checkpointId: string) => Promise<{ ok: boolean; safetyCheckpointId?: string; error?: string }>
}

/**
 * Agent-side checkpoint tools: hip captures a shadow checkpoint after every turn
 * (refs/hip/checkpoints/<sessionId>/<turnId>). These are invisible to plain git,
 * so the agent needs dedicated tools to list and revert them.
 */
export function buildCheckpointTools(ctx: CheckpointToolsCtx): StructuredToolInterface[] {
  const { cwd, sessionId, list, revert } = ctx
  if (!cwd || !sessionId || !list || !revert) return []

  const checkpointListTool = tool(
    async () => {
      const cps = await list()
      if (cps.length === 0) {
        return 'No checkpoints yet for this session.'
      }
      return cps
        .map((c) => {
          const sha = c.commitSha ? c.commitSha.slice(0, 7) : '?'
          return `- ${c.id}${c.label ? ` (${c.label})` : ''} kind=${c.kind} branch=${c.branch ?? '-'} sha=${sha}`
        })
        .join('\n')
    },
    {
      name: 'git_checkpoint_list',
      description:
        'List hip checkpoints for the current session (newest first). Each turn the agent ' +
        'completes creates a checkpoint automatically. Returns one line per checkpoint: ' +
        'id, label, kind (start/turn/pre-revert), branch, and commit sha. Use the id with ' +
        'git_checkpoint_revert to restore the workspace to that point.',
      schema: z.object({}),
    },
  )

  const checkpointRevertTool = tool(
    async ({ checkpointId }) => {
      const r = await revert(checkpointId)
      if (!r.ok) return `Error: ${r.error ?? 'revert failed'}`
      return (
        `Reverted the workspace to checkpoint ${checkpointId}. ` +
        (r.safetyCheckpointId
          ? `A safety checkpoint ${r.safetyCheckpointId} was created first so this revert is itself undoable.`
          : '')
      )
    },
    {
      name: 'git_checkpoint_revert',
      description:
        'Restore the working tree exactly to the state of a hip checkpoint (see git_checkpoint_list). ' +
        'A safety checkpoint is created automatically before reverting, and HEAD is never moved, so the ' +
        'revert is undoable. Use when the user asks to undo changes back to an earlier turn.',
      schema: z.object({ checkpointId: z.string() }),
    },
  )

  return [checkpointListTool, checkpointRevertTool]
}
