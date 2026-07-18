import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildWorktreePatch, captureGitAfter, captureGitBaseline } from './git.js'

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function gitOut(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd()
}

describe('captureGitAfter / buildWorktreePatch', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hip-cli-git-'))
    git(root, 'init')
    git(root, 'config', 'user.email', 't@t')
    git(root, 'config', 'user.name', 't')
    writeFileSync(join(root, 'f.go'), 'orig\n')
    git(root, 'add', 'f.go')
    git(root, 'commit', '-m', 'init')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('MM (staged break + worktree fix): single patch is worktree vs HEAD, not cached break', () => {
    // Simulate eval `git apply --index` then agent edit of worktree only.
    writeFileSync(join(root, 'f.go'), 'broken\n')
    git(root, 'add', 'f.go')
    writeFileSync(join(root, 'f.go'), 'fixed\n')
    expect(gitOut(root, 'status', '--porcelain')).toMatch(/^MM\s+f\.go/)

    const built = buildWorktreePatch(root)
    expect(built.ok).toBe(true)
    if (!built.ok) return

    // Final worktree content must appear once.
    expect(built.patch).toContain('+fixed')
    // Intentional staged break must NOT appear as a second contradictory hunk.
    expect(built.patch).not.toContain('+broken')
    // Exactly one diff header for f.go (not two concatenated diffs).
    const headers = built.patch.match(/^diff --git /gm) ?? []
    expect(headers.length).toBe(1)

    const baseline = captureGitBaseline(root)
    const outDir = join(root, 'out')
    mkdirSync(outDir)
    const after = captureGitAfter(root, baseline, { outDir })
    expect(after.git.dirtyAfter).toBe(true)
    expect(after.git.patchStatus).toBe('written')
    const onDisk = readFileSync(join(outDir, 'patch.diff'), 'utf8')
    expect(onDisk).toBe(built.patch)
    expect(onDisk).toContain('+fixed')
    expect(onDisk).not.toContain('+broken')
  })

  it('includes untracked files as new-file hunks without staging them', () => {
    writeFileSync(join(root, 'new.txt'), 'hello untracked\n')
    const beforeStatus = gitOut(root, 'status', '--porcelain')
    expect(beforeStatus).toMatch(/\?\?\s+new\.txt/)

    const built = buildWorktreePatch(root)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.patch).toMatch(/new file|--- \/dev\/null|\+hello untracked/)
    expect(built.patch).toContain('new.txt')

    // Index must remain clean of new.txt (no mutate).
    const cached = gitOut(root, 'diff', '--cached', '--name-only')
    expect(cached).not.toContain('new.txt')
    expect(gitOut(root, 'status', '--porcelain')).toMatch(/\?\?\s+new\.txt/)
  })

  it('clean tree yields empty patch', () => {
    const built = buildWorktreePatch(root)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.patch.trim()).toBe('')
  })

  it('staged-only change still appears via git diff HEAD', () => {
    writeFileSync(join(root, 'f.go'), 'staged-only\n')
    git(root, 'add', 'f.go')
    // worktree matches index
    expect(gitOut(root, 'status', '--porcelain')).toMatch(/^M\s+f\.go/)

    const built = buildWorktreePatch(root)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.patch).toContain('+staged-only')
    expect(built.patch).not.toContain('+orig')
  })
})
