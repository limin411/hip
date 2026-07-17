import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  createWorktreeService,
  isEphemeralWorktree,
  resolveRepoBinding,
} from './worktree-service.js'
import { loadMeta, worktreeIdFromPath } from './worktree-meta.js'
import { repoSlug } from './worktree-paths.js'
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
  // Most tests expect flat layout; PR2b product default is nest-on when unset.
  process.env.HIP_WORKTREES_NEST = '0'
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

    const { repoKey } = await resolveRepoBinding(root)
    expect(created.worktree!.repoKey).toBe(repoKey)
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
    expect(listed.worktrees.filter((w) => w.isPrimary)).toHaveLength(1)
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

  it('remove deletes meta and notifies removed with sessionId/repoKey', async () => {
    await git(root, 'branch', 'to-drop')
    const events: Array<{ kind: string; sessionId?: string; repoKey: string }> = []
    const svc = createWorktreeService({
      notify: (ev) => events.push({ kind: ev.kind, sessionId: ev.sessionId, repoKey: ev.repoKey }),
    })
    const created = await svc.create({
      cwd: root,
      branch: 'to-drop',
      source: 'protocol',
      hostSessionId: 'host-create',
    })
    expect(created.ok).toBe(true)

    const removed = await svc.remove({
      cwd: root,
      worktreePath: created.path!,
      hostSessionId: 's1',
    })
    expect(removed.ok).toBe(true)
    expect(events.map((e) => e.kind)).toContain('created')
    expect(events.map((e) => e.kind)).toContain('removed')
    const remEv = events.find((e) => e.kind === 'removed')
    expect(remEv!.sessionId).toBe('s1')
    expect(remEv!.repoKey).toBe(created.worktree!.repoKey)

    const { repoKey } = await resolveRepoBinding(root)
    const meta = loadMeta(repoKey)
    expect(meta?.records[created.worktree!.id]).toBeUndefined()
  })

  it('worktreeIdFromPath is stable for same path', () => {
    const repoKey = 'abc123'
    const p = path.join(worktreesDir, 'slot-1')
    expect(worktreeIdFromPath(repoKey, p)).toBe(worktreeIdFromPath(repoKey, p))
  })

  it('HIP_WORKTREES_NEST=1 nests create path under repoSlug', async () => {
    process.env.HIP_WORKTREES_NEST = '1'
    await git(root, 'branch', 'nested-feat')
    const svc = createWorktreeService()
    const created = await svc.create({
      cwd: root,
      branch: 'nested-feat',
      source: 'protocol',
    })
    expect(created.ok).toBe(true)
    const slug = repoSlug(root)
    expect(created.path).toContain(path.join(worktreesDir, slug))
    expect(created.path!.startsWith(path.join(worktreesDir, slug))).toBe(true)
  })

  it('unset HIP_WORKTREES_NEST nests by default (PR2b)', async () => {
    delete process.env.HIP_WORKTREES_NEST
    await git(root, 'branch', 'default-nest')
    const svc = createWorktreeService()
    const created = await svc.create({
      cwd: root,
      branch: 'default-nest',
      source: 'protocol',
    })
    expect(created.ok).toBe(true)
    const slug = repoSlug(root)
    expect(created.path!.startsWith(path.join(worktreesDir, slug))).toBe(true)
  })

  it('create from main → list from linked cwd shares repoKey, single isPrimary, meta id', async () => {
    await git(root, 'branch', 'linked-feat')
    const svc = createWorktreeService()
    const created = await svc.create({
      cwd: root,
      branch: 'linked-feat',
      source: 'protocol',
      hostSessionId: 'main-sess',
    })
    expect(created.ok).toBe(true)
    const linkedCwd = created.path!
    const mainBinding = await resolveRepoBinding(root)
    const linkedBinding = await resolveRepoBinding(linkedCwd)
    expect(linkedBinding.repoKey).toBe(mainBinding.repoKey)
    expect(created.worktree!.repoKey).toBe(mainBinding.repoKey)

    const listed = await svc.list({ cwd: linkedCwd })
    expect(listed.ok).toBe(true)
    expect(listed.worktrees.every((w) => w.repoKey === mainBinding.repoKey)).toBe(true)
    expect(listed.worktrees.filter((w) => w.isPrimary)).toHaveLength(1)
    const primary = listed.worktrees.find((w) => w.isPrimary)!
    // Primary is main checkout, not the linked cwd (realpath-safe compare)
    expect(await fs.realpath(primary.path)).toBe(await fs.realpath(mainBinding.primaryPath))
    expect(await fs.realpath(primary.path)).not.toBe(await fs.realpath(linkedCwd))
    const managed = listed.worktrees.find((w) => w.branch === 'linked-feat')
    expect(managed).toBeTruthy()
    expect(managed!.id).toBe(created.worktree!.id)
    expect(managed!.isPrimary).toBe(false)
  })
})
