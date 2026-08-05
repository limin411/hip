import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createIsolation, discardIsolation, listIsolations } from './isolation.js'

describe('isolation worktree', () => {
  let repo: string

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'hip-iso-repo-'))
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: repo })
    writeFileSync(join(repo, 'a.txt'), 'hello\n')
    execFileSync('git', ['add', '-A'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repo })
  })

  afterEach(() => {
    for (const r of listIsolations(repo)) {
      discardIsolation({ repoPath: repo, worktreeId: r.id })
    }
    rmSync(repo, { recursive: true, force: true })
  })

  it('creates and discards a worktree', () => {
    const r = createIsolation({ repoPath: repo, sessionId: 's1' })
    expect(r.ok).toBe(true)
    expect(r.worktree?.path).toBeTruthy()
    expect(existsSync(r.worktree!.path)).toBe(true)
    expect(listIsolations(repo).length).toBe(1)
    expect(discardIsolation({ repoPath: repo, worktreeId: r.worktree!.id }).ok).toBe(true)
    expect(listIsolations(repo).length).toBe(0)
  })
})
