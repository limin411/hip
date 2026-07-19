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
    const changed: Array<{
      kind: string
      reveal?: boolean
      worktree: { branch?: string; pathKey?: string; path: string; source?: string }
    }> = []
    const tools = buildParallelWorktreeTools({
      cwd: repo,
      sessionId: 'sess',
      requestChoice: async () => ({ optionId: 'n2' }),
      spawnInWorktree: async ({ taskId, root }) => {
        spawns.push({ taskId, root })
        return `Background task started: ${taskId}`
      },
      // D23: product parallel must suppress per-slot reveal/toast.
      onWorktreeChanged: (ev) => {
        changed.push({
          kind: ev.kind,
          reveal: ev.reveal,
          worktree: {
            branch: ev.worktree.branch,
            pathKey: ev.worktree.pathKey,
            path: ev.worktree.path,
            source: ev.worktree.source,
          },
        })
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

    // D23: every slot create notifies with reveal false (via createManagedProductWorktree).
    // PR7 / D26: agent tool source is `parallel` (not host_fanout / protocol).
    expect(changed).toHaveLength(2)
    expect(changed.every((e) => e.kind === 'created' && e.reveal === false)).toBe(true)
    expect(changed.every((e) => e.worktree.source === 'parallel')).toBe(true)

    // D26: hip-p-{runShort}-{1..n} branches; pathKey = {runId}/{branch}; path under managed + runId.
    const parsed = JSON.parse(out) as {
      runId: string
      slots: Array<{ branch: string; path: string; index: number }>
    }
    expect(parsed.runId).toMatch(/^[a-f0-9]{10}$/)
    const runShort = parsed.runId.slice(0, 6)
    expect(parsed.slots).toHaveLength(2)
    for (const slot of parsed.slots) {
      expect(slot.branch).toBe(`hip-p-${runShort}-${slot.index}`)
      expect(slot.path.startsWith(getWorktreesDir())).toBe(true)
      expect(slot.path).toContain(parsed.runId)
    }
    for (const ev of changed) {
      expect(ev.worktree.branch).toMatch(new RegExp(`^hip-p-${runShort}-[12]$`))
      expect(ev.worktree.pathKey).toBe(`${parsed.runId}/${ev.worktree.branch}`)
    }
  })
})
