// packages/sidecar/src/session/turn-diff-tracker.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { collectTurnDiff, looksLikeGitRepo } from './turn-diff-tracker.js'

let repo: string

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-turn-diff-'))
  runGit(repo, ['init', '-q'])
  runGit(repo, ['config', 'user.email', 'test@example.com'])
  runGit(repo, ['config', 'user.name', 'Test'])
  fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n')
  runGit(repo, ['add', '.'])
  runGit(repo, ['commit', '-q', '-m', 'init'])
})

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('looksLikeGitRepo', () => {
  it('detects git repos and rejects plain dirs', () => {
    expect(looksLikeGitRepo(repo)).toBe(true)
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-plain-'))
    expect(looksLikeGitRepo(plain)).toBe(false)
    fs.rmSync(plain, { recursive: true, force: true })
  })

  it('handles empty cwd', () => {
    expect(looksLikeGitRepo('')).toBe(false)
  })
})

describe('collectTurnDiff', () => {
  it('returns null for non-repo dirs', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-plain-'))
    expect(await collectTurnDiff(plain)).toBeNull()
    fs.rmSync(plain, { recursive: true, force: true })
  })

  it('summarizes changes since HEAD', async () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\nworld\n')
    fs.writeFileSync(path.join(repo, 'b.txt'), 'new\nfile\nlines\n')
    const diff = await collectTurnDiff(repo, 5000)
    expect(diff).not.toBeNull()
    expect(diff!.files).toBe(2)
    expect(diff!.additions).toBe(4) // 1 (a.txt) + 3 (b.txt)
    expect(diff!.deletions).toBe(0)
  })

  it('returns null when nothing changed', async () => {
    runGit(repo, ['stash', '-u', '-q'])
    try {
      const diff = await collectTurnDiff(repo, 5000)
      expect(diff).toBeNull()
    } finally {
      runGit(repo, ['stash', 'pop', '-q'])
    }
  })
})
