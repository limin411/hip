import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { buildParallelWorktreeTools } from './parallel-worktree.js'
import { getWorktreesDir } from '../worktree-config.js'

const execFileP = promisify(execFile)
const git = (cwd: string, ...args: string[]) => execFileP('git', args, { cwd })

async function makeRepo(dir: string): Promise<void> {
  await git(dir, 'init')
  await fs.writeFile(path.join(dir, 'a.txt'), 'one\n')
  await git(dir, 'add', '-A')
  await git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init')
}

describe('parallel_worktrees tool', () => {
  let repo: string
  let worktreesDir: string
  let prevWt: string | undefined

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-pwt-repo-'))
    worktreesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-pwt-wts-'))
    prevWt = process.env.HIP_WORKTREES_DIR
    process.env.HIP_WORKTREES_DIR = worktreesDir
    await makeRepo(repo)
  })

  afterEach(async () => {
    if (prevWt === undefined) delete process.env.HIP_WORKTREES_DIR
    else process.env.HIP_WORKTREES_DIR = prevWt
    await fs.rm(repo, { recursive: true, force: true })
    await fs.rm(worktreesDir, { recursive: true, force: true })
  })

  it('returns declined message when user rejects', async () => {
    const tools = buildParallelWorktreeTools({
      cwd: repo,
      sessionId: 'sess',
      requestChoice: async () => ({ optionId: 'reject' }),
      spawnInWorktree: async () => 'should-not-run',
    })
    const t = tools[0]!
    const out = await t.invoke({
      goal: 'try two approaches',
      suggested_count: 2,
      rationale: 'compare A vs B',
    })
    expect(String(out)).toMatch(/declined/i)
  })

  it('creates worktrees and spawns workers after n2 approve', async () => {
    const spawns: Array<{ taskId: string; root: string }> = []
    const tools = buildParallelWorktreeTools({
      cwd: repo,
      sessionId: 'sess',
      requestChoice: async () => ({ optionId: 'n2' }),
      spawnInWorktree: async ({ taskId, root }) => {
        spawns.push({ taskId, root })
        return `Background task started: ${taskId}`
      },
    })
    const t = tools[0]!
    const out = String(
      await t.invoke({
        goal: 'implement feature X',
        suggested_count: 3,
        rationale: 'two independent designs',
      }),
    )
    expect(spawns).toHaveLength(2)
    expect(out).toContain('"count": 2')
    for (const s of spawns) {
      expect(s.root.startsWith(getWorktreesDir())).toBe(true)
      const st = await fs.stat(s.root)
      expect(st.isDirectory()).toBe(true)
    }
  })
})
