import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { PermissionOption } from '@hip/protocol'
import { gitCreateBranch, sanitizeRefComponent } from '../workspace-git.js'
import { createWorktreeService } from '../worktree-service.js'
import type { WorktreeChangedNotify } from '../worktree-service.js'

export type ParallelChoiceFn = (req: {
  title: string
  kind: string
  content: string
  options: PermissionOption[]
}) => Promise<{ optionId: string } | { cancelled: true }>

export type ParallelSlotSpawnFn = (args: {
  taskId: string
  description: string
  root: string
}) => Promise<string>

export interface ParallelWorktreeToolOpts {
  cwd: string
  sessionId: string
  requestChoice: ParallelChoiceFn
  spawnInWorktree: ParallelSlotSpawnFn
  /** Notify UI / protocol when slots are ready (after HITL). */
  onRunStarted?: (payload: {
    runId: string
    baseCwd: string
    goal: string
    slots: Array<{ index: number; branch: string; path: string; taskId: string; worktreeId?: string }>
  }) => void
  /** Product catalog emit (same send path as git_worktree_create). */
  onWorktreeChanged?: WorktreeChangedNotify
}

/** Keep in sync with src/lib/parallelCount.ts PARALLEL_COUNT_MIN/MAX. */
function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 2
  return Math.min(4, Math.max(1, Math.floor(n)))
}

function parseCountOption(optionId: string): number | null {
  const m = /^n([1-4])$/.exec(optionId)
  if (!m) return null
  return Number(m[1])
}

/**
 * Agent-driven parallel worktrees: propose N isolated slots, HITL for user count, then
 * create persistent worktrees and start background workers in each.
 */
export function buildParallelWorktreeTools(opts: ParallelWorktreeToolOpts): StructuredToolInterface[] {
  const { cwd, sessionId, requestChoice, spawnInWorktree, onRunStarted, onWorktreeChanged } = opts

  const parallelWorktrees = tool(
    async ({ goal, suggested_count, rationale, variants }) => {
      const suggested = clampCount(suggested_count)
      const content = [
        rationale.trim(),
        '',
        `Suggested parallel slots: ${suggested}`,
        `Goal: ${goal.trim()}`,
        '',
        'Choose how many isolated git worktrees to create. Each slot runs a worker on a separate branch under ~/.hip/worktrees (main tree is not modified by workers).',
      ].join('\n')

      const options: PermissionOption[] = [
        {
          optionId: 'n1',
          name: suggested === 1 ? '隔离 1 路（建议）' : '隔离 1 路',
          kind: 'allow_once',
        },
        {
          optionId: 'n2',
          name: suggested === 2 ? '并行 2 路（建议）' : '并行 2 路',
          kind: 'allow_once',
        },
        {
          optionId: 'n3',
          name: suggested === 3 ? '并行 3 路（建议）' : '并行 3 路',
          kind: 'allow_once',
        },
        {
          optionId: 'n4',
          name: suggested === 4 ? '并行 4 路（建议）' : '并行 4 路',
          kind: 'allow_once',
        },
        { optionId: 'reject', name: '不要并行', kind: 'reject_once' },
      ]

      const choice = await requestChoice({
        title: '并行 Worktree',
        kind: 'parallel_worktrees',
        content,
        options,
      })

      if ('cancelled' in choice || choice.optionId === 'reject') {
        return 'User declined parallel worktrees. Continue in the main working tree with a single approach (or ask a different plan).'
      }

      const count = parseCountOption(choice.optionId)
      if (count == null) {
        return `Error: unexpected choice ${choice.optionId}`
      }

      const runId = randomUUID().replace(/-/g, '').slice(0, 10)
      const runShort = runId.slice(0, 6)
      const slots: Array<{
        index: number
        branch: string
        path: string
        taskId: string
        worktreeId?: string
        spawnResult: string
      }> = []

      const wtSvc = createWorktreeService({ notify: onWorktreeChanged })

      for (let i = 1; i <= count; i++) {
        const branch = `hip-p-${runShort}-${i}`
        const pathKey = `${runId}/${branch}`
        const br = await gitCreateBranch(cwd, branch)
        if (!br.ok && !/already exists/i.test(br.error ?? '')) {
          return `Error: failed to create branch ${branch}: ${br.error ?? 'unknown'}`
        }
        const wt = await wtSvc.create({
          cwd,
          branch,
          pathKey,
          source: 'parallel',
          hostSessionId: sessionId,
          parallelRunId: runId,
          taskId: `pwt-${sanitizeRefComponent(runShort)}-${i}`,
          reveal: false,
        })
        if (!wt.ok || !wt.path) {
          return `Error: failed to create worktree for ${branch}: ${wt.error ?? 'unknown'}`
        }

        const taskId = `pwt-${sanitizeRefComponent(runShort)}-${i}`
        const variant =
          variants && variants[i - 1]?.trim()
            ? variants[i - 1]!.trim()
            : `${goal.trim()}\n\n[Parallel slot ${i}/${count} on branch ${branch}. Work only in this worktree.]`
        const spawnResult = await spawnInWorktree({
          taskId,
          description: variant,
          root: wt.path,
        })
        slots.push({
          index: i,
          branch,
          path: wt.path,
          taskId,
          worktreeId: wt.worktree?.id,
          spawnResult,
        })
      }

      onRunStarted?.({
        runId,
        baseCwd: cwd,
        goal: goal.trim(),
        slots: slots.map((s) => ({
          index: s.index,
          branch: s.branch,
          path: s.path,
          taskId: s.taskId,
          worktreeId: s.worktreeId,
        })),
      })

      return JSON.stringify(
        {
          runId,
          sessionId,
          count,
          goal: goal.trim(),
          slots: slots.map((s) => ({
            index: s.index,
            branch: s.branch,
            path: s.path,
            taskId: s.taskId,
            worktreeId: s.worktreeId,
            spawn: s.spawnResult,
          })),
          next:
            'Workers run in background. Use task_output with each taskId to poll. Worktrees are kept for user review (not auto-deleted). Summarize results and ask which slot to keep if needed.',
        },
        null,
        2,
      )
    },
    {
      name: 'parallel_worktrees',
      description:
        'Propose running the same (or variant) coding goal in N isolated git worktrees in parallel. ' +
        'ALWAYS use this instead of inventing ad-hoc multi-worktree scripts when the user wants ' +
        'multiple competing approaches, best-of-N, or safe parallel exploration. ' +
        'The tool ALWAYS asks the user (HITL) how many slots (2–4) or to cancel — you only suggest. ' +
        'Do not call for trivial single-file fixes. After approval, workers start in background; ' +
        'poll with task_output and report a comparison.',
      schema: z.object({
        goal: z.string().describe('What each parallel worker should accomplish'),
        suggested_count: z
          .number()
          .describe('Your recommended slot count (2–4); user may pick a different count'),
        rationale: z
          .string()
          .describe('Short explanation shown to the user in the approval dialog'),
        variants: z
          .array(z.string())
          .optional()
          .describe('Optional per-slot instructions (index 0 = slot 1). If omitted, goal is reused.'),
      }),
    },
  )

  return [parallelWorktrees]
}
