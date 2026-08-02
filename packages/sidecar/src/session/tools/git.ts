import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { gitCommit, gitCreateBranch, gitSwitchBranch } from '../workspace-git.js'

export function buildGitTools(
  cwd: string | undefined,
): StructuredToolInterface[] {
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
  return [gitCommitTool, gitCreateBranchTool, gitSwitchBranchTool]
}
