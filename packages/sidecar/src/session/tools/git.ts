import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { gitCommit, gitCreateBranch, gitSwitchBranch } from '../workspace-git.js'
import {
  createWorktreeService,
  type WorktreeChangedNotify,
} from '../worktree-service.js'

export interface BuildGitToolsOpts {
  /** Session id for meta hostSessionId + worktree:changed correlation. */
  sessionId?: string
  /** Emit worktree:changed (mirrors onParallelRunStarted → send). */
  onWorktreeChanged?: WorktreeChangedNotify
}

export function buildGitTools(
  cwd: string | undefined,
  opts: BuildGitToolsOpts = {},
): StructuredToolInterface[] {
  if (!cwd) return []

  const svc = () =>
    createWorktreeService({
      notify: opts.onWorktreeChanged,
    })

  const gitCommitTool = tool(
    async ({ message }) => {
      const r = await gitCommit(cwd, message)
      return r.ok ? `committed ${(r.sha ?? '').slice(0, 7)}` : `Error: ${r.error ?? 'commit failed'}`
    },
    {
      name: 'git_commit',
      description:
        'Stage all changes and create a git commit with the given one-line `message`. Use ' +
        'proactively after completing a coherent unit of work (not per file). Returns "committed <sha>" ' +
        'or an error.',
      schema: z.object({ message: z.string() }),
    },
  )
  const gitCreateBranchTool = tool(
    async ({ branchName }) => {
      const r = await gitCreateBranch(cwd, branchName)
      return r.ok ? `created branch ${branchName}` : `Error: ${r.error ?? 'create branch failed'}`
    },
    {
      name: 'git_create_branch',
      description: 'Create a new git branch named `branchName` at the current HEAD (does not switch to it).',
      schema: z.object({ branchName: z.string() }),
    },
  )
  const gitSwitchBranchTool = tool(
    async ({ branchName }) => {
      const r = await gitSwitchBranch(cwd, branchName)
      return r.ok ? `switched to ${branchName}` : `Error: ${r.error ?? 'switch branch failed'}`
    },
    {
      name: 'git_switch_branch',
      description: 'Switch the checkout to an existing git branch named `branchName`.',
      schema: z.object({ branchName: z.string() }),
    },
  )
  const gitWorktreeCreateTool = tool(
    async ({ branch }) => {
      try {
        const r = await svc().create({
          cwd,
          branch,
          pathKey: branch,
          source: 'agent_tool',
          hostSessionId: opts.sessionId,
          reveal: true,
        })
        if (!r.ok) return `Error: ${r.error ?? 'create worktree failed'}`
        return JSON.stringify({
          path: r.path,
          id: r.worktree?.id,
          branch,
        })
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'git_worktree_create',
      description:
        'Create a linked git worktree at the branch `branch` in the managed worktrees directory. ' +
        'The branch must already exist — create it first with git_create_branch if needed. ' +
        'Returns JSON { path, id, branch } or an error.',
      schema: z.object({ branch: z.string() }),
    },
  )
  const gitWorktreeListTool = tool(
    async () => {
      try {
        const r = await svc().list({ cwd, managedOnly: false, hideEphemeral: false })
        return r.ok ? JSON.stringify(r.worktrees) : `Error: ${r.error ?? 'list worktrees failed'}`
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'git_worktree_list',
      description:
        'List all linked git worktrees for the current repository. ' +
        'Returns a JSON array of worktree info objects (path, branch, head, optional id/managed).',
      schema: z.object({}),
    },
  )
  const gitWorktreeRemoveTool = tool(
    async ({ worktreePath, force }) => {
      try {
        const r = await svc().remove({
          cwd,
          worktreePath,
          force: force === true,
          hostSessionId: opts.sessionId,
        })
        return r.ok ? `Removed worktree at ${worktreePath}` : `Error: ${r.error ?? 'remove worktree failed'}`
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'git_worktree_remove',
      description:
        'Remove a linked git worktree at `worktreePath`. The path must be inside the managed ' +
        'worktrees directory. Default is preflight (dirty fails); pass force:true to force-remove. ' +
        'Use git_worktree_list to see available worktrees.',
      schema: z.object({
        worktreePath: z.string(),
        force: z.boolean().optional(),
      }),
    },
  )

  return [gitCommitTool, gitCreateBranchTool, gitSwitchBranchTool, gitWorktreeCreateTool, gitWorktreeListTool, gitWorktreeRemoveTool]
}
