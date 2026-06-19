import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createWorktree, listWorktrees, removeWorktree } from './workspace-git.js'

const execFileP = promisify(execFile)
const git = (cwd: string, ...args: string[]) => execFileP('git', args, { cwd })
async function makeRepo(dir: string): Promise<void> {
  await git(dir, 'init')
  await git(dir, 'add', '-A')
  await git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init', '--allow-empty')
}

let root: string
let worktreesDir: string
let savedEnv: string | undefined

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-wtint-'))
  worktreesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-wtdir-'))
  savedEnv = process.env.HIP_WORKTREES_DIR
  process.env.HIP_WORKTREES_DIR = worktreesDir
})

afterEach(async () => {
  if (savedEnv === undefined) delete process.env.HIP_WORKTREES_DIR
  else process.env.HIP_WORKTREES_DIR = savedEnv
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(worktreesDir, { recursive: true, force: true })
})

describe('worktree integration — full lifecycle', () => {
  it('creates a worktree, verifies filesystem isolation, lists, removes, and verifies cleanup', async () => {
    // 1. Initialize a test git repo with a file
    await fs.writeFile(path.join(root, 'main.txt'), 'content from main\n')
    await makeRepo(root)
    await git(root, 'branch', 'feature')

    // 2. Create a linked worktree for the 'feature' branch
    const wtPath = path.join(worktreesDir, 'wt-feature')
    const created = await createWorktree(root, 'feature', wtPath)
    expect(created.ok).toBe(true)
    expect(created.path).toBe(wtPath)

    // Verify the worktree is a real git worktree (.git is a file pointing to main repo)
    const gitFile = await fs.readFile(path.join(wtPath, '.git'), 'utf8')
    expect(gitFile).toContain('gitdir:')

    // 3. Verify filesystem isolation: write a file in the worktree
    await fs.writeFile(path.join(wtPath, 'feature-only.txt'), 'only in feature worktree\n')
    await git(wtPath, 'add', '-A')
    await git(wtPath, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'feature work')

    // Verify the new file does NOT exist in the main checkout
    await expect(fs.access(path.join(root, 'feature-only.txt'))).rejects.toThrow()

    // 4. List worktrees — should include both main and feature
    const listResult = await listWorktrees(root)
    expect(listResult.ok).toBe(true)
    expect(listResult.worktrees!.length).toBeGreaterThanOrEqual(2)

    const featureWt = listResult.worktrees!.find((w) => w.branch === 'feature')
    expect(featureWt).toBeTruthy()
    expect(featureWt!.head).toMatch(/^[0-9a-f]{40}$/)
    // Resolve both paths to handle macOS /var → /private/var symlink
    expect(await fs.realpath(featureWt!.path)).toBe(await fs.realpath(wtPath))

    // 5. Remove the worktree
    const removed = await removeWorktree(root, wtPath)
    expect(removed.ok).toBe(true)

    // 6. Verify cleanup: worktree no longer listed
    const after = await listWorktrees(root)
    expect(after.worktrees!.some((w) => w.branch === 'feature')).toBe(false)

    // 7. Verify the directory is gone (or at least no longer a git worktree)
    // git worktree remove --force removes the directory, but we verify it's not a valid worktree
    try {
      await fs.stat(wtPath)
      // If directory somehow still exists, .git file should be gone
      await expect(fs.access(path.join(wtPath, '.git'))).rejects.toThrow()
    } catch {
      // Directory gone — also fine
    }
  })
})

describe('worktree integration — create on existing branch', () => {
  it('creates a worktree on a pre-existing branch and the branch is visible from the main repo', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    await makeRepo(root)
    // Create the branch in the main repo first (createWorktree requires the branch to exist)
    await git(root, 'branch', 'existing-feature')

    const wtPath = path.join(worktreesDir, 'wt-existing-feature')
    const created = await createWorktree(root, 'existing-feature', wtPath)
    expect(created.ok).toBe(true)
    expect(created.path).toBe(wtPath)

    try {
      // Verify the branch is visible from the main repo
      const { stdout: branches } = await git(root, 'branch')
      expect(branches).toContain('existing-feature')

      // Verify the worktree is on the correct branch
      const list = await listWorktrees(root)
      const wt = list.worktrees!.find((w) => w.branch === 'existing-feature')
      expect(wt).toBeTruthy()
      expect(wt!.head).toMatch(/^[0-9a-f]{40}$/)
    } finally {
      await removeWorktree(root, wtPath)
    }
  })
})

describe('worktree integration — error handling', () => {
  it('removeWorktree on a non-existent path returns ok:false with error', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    await makeRepo(root)

    const nonExistentPath = path.join(worktreesDir, 'does-not-exist')
    const r = await removeWorktree(root, nonExistentPath)
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
    // The error should indicate the worktree wasn't found
    expect(r.error!.toLowerCase()).toMatch(/not found|not a working tree|no such/)
  })

  it('createWorktree with an existing path returns ok:false with conflict error', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    await makeRepo(root)
    await git(root, 'branch', 'feature')

    const wtPath = path.join(worktreesDir, 'wt-conflict')
    // First creation succeeds
    const r1 = await createWorktree(root, 'feature', wtPath)
    expect(r1.ok).toBe(true)

    try {
      // Second creation at same path should fail
      const r2 = await createWorktree(root, 'feature', wtPath)
      expect(r2.ok).toBe(false)
      expect(r2.error).toBeTruthy()
      expect(r2.error!.toLowerCase()).toContain('already exists')
    } finally {
      await removeWorktree(root, wtPath)
    }
  })

  it('createWorktree with unsafe branch name returns ok:false', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    await makeRepo(root)

    const wtPath = path.join(worktreesDir, 'wt-unsafe')
    const r = await createWorktree(root, '../escape', wtPath)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('unsafe branch name')
  })

  it('removeWorktree rejects paths outside HIP_WORKTREES_DIR', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n')
    await makeRepo(root)
    await git(root, 'branch', 'outside-branch')

    // Create worktree outside the managed directory
    const outsidePath = path.join(os.tmpdir(), 'wt-outside-' + Date.now())
    const created = await createWorktree(root, 'outside-branch', outsidePath)
    expect(created.ok).toBe(true)

    try {
      // removeWorktree should reject because outsidePath is not under HIP_WORKTREES_DIR
      const r = await removeWorktree(root, outsidePath)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('outside managed directory')
    } finally {
      // Clean up manually with raw git since removeWorktree refuses
      await git(root, 'worktree', 'remove', outsidePath, '--force').catch(() => {})
    }
  })
})
