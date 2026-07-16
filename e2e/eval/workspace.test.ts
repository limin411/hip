import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TaskSpec } from './types.js'
import {
  cleanupWorkspace,
  createTempGitRepo,
  prepareWorkspace,
  primaryMutated,
  snapshotPrimary,
} from './workspace.js'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) {
    try {
      cleanups.pop()?.()
    } catch {
      // ignore
    }
  }
})

describe('eval workspace prepare', () => {
  it('creates worktree from temp repo and cleans up', () => {
    const repo = createTempGitRepo('ws-unit')
    cleanups.push(() => fs.rmSync(repo, { recursive: true, force: true }))

    const task: TaskSpec = {
      schemaVersion: 1,
      id: 'unit-smoke',
      name: 'unit',
      prompt: 'noop',
      workspace: {
        strategy: 'worktree',
        repo_path: repo,
        base_ref: 'HEAD',
        setup: { kind: 'none' },
      },
      ui: { surface: 'code' },
    }

    const before = snapshotPrimary(repo)
    const ws = prepareWorkspace(task, { packDir: repo })
    cleanups.push(() => cleanupWorkspace({ ...ws, keep: false }))

    expect(fs.existsSync(ws.cwd)).toBe(true)
    expect(fs.existsSync(path.join(ws.cwd, 'README.md'))).toBe(true)
    expect(ws.baseSha.length).toBeGreaterThan(7)

    cleanupWorkspace({ ...ws, keep: false })
    expect(fs.existsSync(ws.cwd)).toBe(false)

    const after = snapshotPrimary(repo)
    expect(primaryMutated(before, after)).toBe(false)
  })

  it('rejects inplace strategy', () => {
    const repo = createTempGitRepo('ws-inplace')
    cleanups.push(() => fs.rmSync(repo, { recursive: true, force: true }))
    const task = {
      schemaVersion: 1 as const,
      id: 'bad',
      name: 'bad',
      prompt: 'x',
      workspace: {
        strategy: 'inplace' as unknown as 'worktree',
        repo_path: repo,
      },
      ui: {},
    }
    expect(() => prepareWorkspace(task, { packDir: repo })).toThrow(/forbidden|inplace/i)
  })
})
