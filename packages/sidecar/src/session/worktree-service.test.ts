import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  createWorktreeService,
  isEphemeralWorktree,
} from './worktree-service.js'
import { loadMeta, worktreeIdFromPath, repoKeyFromPrimary } from './worktree-meta.js'
import type { WorktreeRecord } from '@hip/protocol'

const execFileP = promisify(execFile)
const git = (cwd: string, ...args: string[]) => execFileP('git', args, { cwd })

async function makeRepo(dir: string): Promise<void> {
  await git(dir, 'init')
  await git(dir, 'config', 'user.name', 't')
  await git(dir, 'config', 'user.email', 't@t')
  await fs.writeFile(path.join(dir, 'README'), 'hi\n')
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-m', 'init')
}

let root: string
let worktreesDir: string
let savedEnv: string | undefined
let savedNest: string | undefined

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-wtsvc-'))
  worktreesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-wtdir-'))
  savedEnv = process.env.HIP_WORKTREES_DIR
  savedNest = process.env.HIP_WORKTREES_NEST
  process.env.HIP_WORKTREES_DIR = worktreesDir
  delete process.env.HIP_WORKTREES_NEST
  await makeRepo(root)
})

afterEach(async () => {
  if (savedEnv === undefined) delete process.env.HIP_WORKTREES_DIR
  else process.env.HIP_WORKTREES_DIR = savedEnv
  if (savedNest === undefined) delete process.env.HIP_WORKTREES_NEST
  else process.env.HIP_WORKTREES_NEST = savedNest
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(worktreesDir, { recursive: true, force: true })
})

describe('isEphemeralWorktree (KD14)', () => {
  it('flags meta.ephemeral', () => {
    expect(isEphemeralWorktree({ branch: 'feature', ephemeral: true })).toBe(true)
  })

  it('flags hip-bg- branch (case insensitive)', () => {
    expect(isEphemeralWorktree({ branch: 'hip-bg-abc-task' })).toBe(true)
    expect(isEphemeralWorktree({ branch: 'HIP-BG-xyz' })).toBe(true)
  })

  it('does NOT flag parallel-shaped branch hip-p-*', () => {
    expect(isEphemeralWorktree({ branch: 'hip-p-run1-1' })).toBe(false)
    expect(isEphemeralWorktree({ branch: 'feature/foo' })).toBe(false)
  })

  it('path depth alone is not ephemeral — parallel runId/branch still durable', () => {
    // Two-segment path is irrelevant; only branch / meta.ephemeral matter
    expect(isEphemeralWorktree({ branch: 'hip-p-abc-1', ephemeral: false })).toBe(false)
  })
})

describe('WorktreeService create → meta → list', () => {
  it('create writes meta and list returns enriched id', async () => {
    await git(root, 'branch', 'feature-a')
    const events: Array<{ kind: string; reveal?: boolean; worktree: WorktreeRecord }> = []
    const svc = createWorktreeService({
      notify: (ev) => events.push({ kind: ev.kind, reveal: ev.reveal, worktree: ev.worktree }),
    })

    const created = await svc.create({
      cwd: root,
      branch: 'feature-a',
      source: 'protocol',
      hostSessionId: 'sess-1',
    })
    expect(created.ok).toBe(true)
    expect(created.path).toBeTruthy()
    expect(created.worktree?.id).toMatch(/^[0-9a-f]{16}$/)
    expect(created.worktree?.managed).toBe(true)
    expect(created.worktree?.isPrimary).toBe(false)
    expect(created.worktree?.source).toBe('protocol')

    expect(events).toHaveLength(1)
    expect(events[0]!.kind).toBe('created')
    expect(events[0]!.worktree.id).toBe(created.worktree!.id)
    expect(events[0]!.reveal).toBe(true)

    const repoKey = repoKeyFromPrimary(root)
    const meta = loadMeta(repoKey)
    expect(meta).toBeTruthy()
    expect(meta!.records[created.worktree!.id]).toBeTruthy()
    expect(meta!.records[created.worktree!.id]!.path).toBeTruthy()

    const listed = await svc.list({ cwd: root })
    expect(listed.ok).toBe(true)
    const managed = listed.worktrees.find((w) => w.branch === 'feature-a')
    expect(managed).toBeTruthy()
    expect(managed!.id).toBe(created.worktree!.id)
    expect(managed!.managed).toBe(true)
    expect(managed!.repoKey).toBe(repoKey)
    expect(managed!.isPrimary).toBe(false)

    const primary = listed.worktrees.find((w) => w.isPrimary)
    expect(primary).toBeTruthy()
    expect(primary!.id).toBeTruthy()
  })

  it('parallel-shaped path (runId/hip-p-1) is NOT filtered as ephemeral', async () => {
    await git(root, 'branch', 'hip-p-runx-1')
    const svc = createWorktreeService()
    const runId = 'run-abc123'
    const created = await svc.create({
      cwd: root,
      branch: 'hip-p-runx-1',
      pathKey: `${runId}/hip-p-runx-1`,
      source: 'parallel',
      parallelRunId: runId,
    })
    expect(created.ok).toBe(true)
    // Path has two segments under managed dir (runId/branch) — must still list
    expect(created.path).toContain(runId)

    const listed = await svc.list({ cwd: root, hideEphemeral: true })
    expect(listed.ok).toBe(true)
    const row = listed.worktrees.find((w) => w.branch === 'hip-p-runx-1')
    expect(row).toBeTruthy()
    expect(row!.id).toBe(created.worktree!.id)
    expect(isEphemeralWorktree(row!)).toBe(false)
  })

  it('hip-bg branch is filtered as ephemeral by default list', async () => {
    await git(root, 'branch', 'hip-bg-sess-task1')
    const svc = createWorktreeService()
    const created = await svc.create({
      cwd: root,
      branch: 'hip-bg-sess-task1',
      pathKey: 'sess1/task1',
      source: 'background',
      ephemeral: true,
    })
    expect(created.ok).toBe(true)

    const listed = await svc.list({ cwd: root, hideEphemeral: true })
    expect(listed.worktrees.some((w) => w.branch === 'hip-bg-sess-task1')).toBe(false)

    const all = await svc.list({ cwd: root, hideEphemeral: false })
    const bg = all.worktrees.find((w) => w.branch === 'hip-bg-sess-task1')
    expect(bg).toBeTruthy()
    expect(isEphemeralWorktree(bg!)).toBe(true)
  })

  it('remove deletes meta and notifies removed', async () => {
    await git(root, 'branch', 'to-drop')
    const events: string[] = []
    const svc = createWorktreeService({
      notify: (ev) => events.push(ev.kind),
    })
    const created = await svc.create({
      cwd: root,
      branch: 'to-drop',
      source: 'protocol',
    })
    expect(created.ok).toBe(true)

    const removed = await svc.remove({
      cwd: root,
      worktreePath: created.path!,
      hostSessionId: 's1',
    })
    expect(removed.ok).toBe(true)
    expect(events).toContain('created')
    expect(events).toContain('removed')

    const repoKey = repoKeyFromPrimary(root)
    const meta = loadMeta(repoKey)
    expect(meta?.records[created.worktree!.id]).toBeUndefined()
  })

  it('worktreeIdFromPath is stable for same path', () => {
    const repoKey = 'abc123'
    const p = path.join(worktreesDir, 'slot-1')
    expect(worktreeIdFromPath(repoKey, p)).toBe(worktreeIdFromPath(repoKey, p))
  })
})
