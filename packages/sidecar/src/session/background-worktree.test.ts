import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { acquireBackgroundWorktree } from './background-worktree.js'
import { existsSync } from 'node:fs'

const execFileP = promisify(execFile)

async function git(cwd: string, ...args: string[]) {
  await execFileP('git', args, { cwd })
}

describe('acquireBackgroundWorktree', () => {
  let repo: string
  let worktreesDir: string
  const prev = process.env.HIP_WORKTREES_DIR
  const prevBg = process.env.HIP_BG_WORKTREE

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'hip-bg-repo-'))
    worktreesDir = await mkdtemp(join(tmpdir(), 'hip-bg-wtdir-'))
    process.env.HIP_WORKTREES_DIR = worktreesDir
    delete process.env.HIP_BG_WORKTREE
    await git(repo, 'init')
    await git(repo, 'config', 'user.email', 't@example.com')
    await git(repo, 'config', 'user.name', 't')
    await writeFile(join(repo, 'README.md'), 'hi\n')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-m', 'init')
  })

  afterEach(async () => {
    if (prev === undefined) delete process.env.HIP_WORKTREES_DIR
    else process.env.HIP_WORKTREES_DIR = prev
    if (prevBg === undefined) delete process.env.HIP_BG_WORKTREE
    else process.env.HIP_BG_WORKTREE = prevBg
    await rm(repo, { recursive: true, force: true })
    await rm(worktreesDir, { recursive: true, force: true })
  })

  it('creates an isolated worktree under HIP_WORKTREES_DIR', async () => {
    const h = await acquireBackgroundWorktree(repo, 'sess1', 'task-a')
    expect(h.isolated).toBe(true)
    expect(h.root.startsWith(worktreesDir)).toBe(true)
    expect(existsSync(h.root)).toBe(true)
    await h.cleanup()
  })

  it('respects HIP_BG_WORKTREE=0', async () => {
    process.env.HIP_BG_WORKTREE = '0'
    const h = await acquireBackgroundWorktree(repo, 'sess1', 'task-b')
    expect(h.isolated).toBe(false)
    expect(h.root).toBe(repo)
  })

  it('falls back when cwd is not a git repo', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'hip-bg-bare-'))
    try {
      const h = await acquireBackgroundWorktree(bare, 's', 't')
      expect(h.isolated).toBe(false)
      expect(h.root).toBe(bare)
    } finally {
      await rm(bare, { recursive: true, force: true })
    }
  })
})
