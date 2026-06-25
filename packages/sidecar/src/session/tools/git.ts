import * as path from 'node:path'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { gitCommit, gitCreateBranch, gitSwitchBranch, createWorktree, listWorktrees, removeWorktree } from '../workspace-git.js'
import { getWorktreesDir } from '../worktree-config.js'

export function buildGitTools(cwd: string | undefined): StructuredToolInterface[] {
  if (!cwd) return []

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
        const worktreePath = path.join(getWorktreesDir(), branch)
        const r = await createWorktree(cwd, branch, worktreePath)
        return r.ok ? `Worktree created at ${r.path}` : `Error: ${r.error ?? 'create worktree failed'}`
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'git_worktree_create',
      description:
        'Create a linked git worktree at the branch `branch` in the managed worktrees directory. ' +
        'The branch must already exist — create it first with git_create_branch if needed. ' +
        'Returns the path to the newly created worktree or an error.',
      schema: z.object({ branch: z.string() }),
    },
  )
  const gitWorktreeListTool = tool(
    async () => {
      try {
        const r = await listWorktrees(cwd)
        return r.ok ? JSON.stringify(r.worktrees) : `Error: ${r.error ?? 'list worktrees failed'}`
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'git_worktree_list',
      description:
        'List all linked git worktrees for the current repository. ' +
        'Returns a JSON array of { path, branch, head } objects.',
      schema: z.object({}),
    },
  )
  const gitWorktreeRemoveTool = tool(
    async ({ worktreePath }) => {
      try {
        const r = await removeWorktree(cwd, worktreePath)
        return r.ok ? `Removed worktree at ${worktreePath}` : `Error: ${r.error ?? 'remove worktree failed'}`
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'git_worktree_remove',
      description:
        'Remove a linked git worktree at `worktreePath`. The path must be inside the managed ' +
        'worktrees directory. Use git_worktree_list to see available worktrees.',
      schema: z.object({ worktreePath: z.string() }),
    },
  )

  return [gitCommitTool, gitCreateBranchTool, gitSwitchBranchTool, gitWorktreeCreateTool, gitWorktreeListTool, gitWorktreeRemoveTool]
}
