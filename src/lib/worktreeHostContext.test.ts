import { describe, expect, it } from 'vitest'
import {
  resolveWorktreeHostContext,
  resolveWorktreeListCatalogHost,
} from './worktreeHostContext'
import type { ParallelRun } from '@/store/parallelStore'
import type { CatalogWorktree } from '@/store/worktreeStore'

function run(partial: Partial<ParallelRun> & Pick<ParallelRun, 'id' | 'hostSessionId'>): ParallelRun {
  return {
    baseCwd: '/repo',
    prompt: 'p',
    slots: [],
    createdAt: 1,
    source: 'host',
    ...partial,
  }
}

function catalog(
  rows: Array<Partial<CatalogWorktree> & Pick<CatalogWorktree, 'id' | 'path'>>,
): CatalogWorktree[] {
  return rows.map((r) => ({
    branch: r.branch ?? 'main',
    head: r.head ?? 'abc',
    repoKey: r.repoKey ?? 'repo',
    isPrimary: r.isPrimary ?? false,
    managed: r.managed ?? !r.isPrimary,
    ...r,
  }))
}

describe('resolveWorktreeHostContext', () => {
  it('1. no active session → unresolved no_active', () => {
    const ctx = resolveWorktreeHostContext({
      activeSession: null,
      sessions: [],
      runs: [],
      catalog: [],
    })
    expect(ctx.unresolved).toBe(true)
    expect(ctx.unresolvedReason).toBe('no_active')
    expect(ctx.hostSessionId).toBe('')
  })

  it('2. active is parallel slot → host = run.hostSessionId', () => {
    const runs = [
      run({
        id: 'r1',
        hostSessionId: 'host',
        slots: [
          {
            index: 0,
            sessionId: 'slot-a',
            worktreePath: '/Users/x/.hip/worktrees/r1/a',
            branch: 'hip-p-r1-0',
            status: 'ready',
          },
        ],
      }),
    ]
    const ctx = resolveWorktreeHostContext({
      activeSession: {
        id: 'slot-a',
        config: { cwd: '/Users/x/.hip/worktrees/r1/a', surface: 'code' },
      },
      sessions: [
        { id: 'host', config: { cwd: '/repo' } },
        { id: 'slot-a', config: { cwd: '/Users/x/.hip/worktrees/r1/a' } },
      ],
      runs,
      catalog: catalog([
        { id: 'p', path: '/repo', isPrimary: true, managed: false },
        {
          id: 'w1',
          path: '/Users/x/.hip/worktrees/r1/a',
          isPrimary: false,
          managed: true,
          hostSessionId: 'host',
        },
      ]),
    })
    expect(ctx.unresolved).toBe(false)
    expect(ctx.hostSessionId).toBe('host')
    expect(ctx.isOnIsolated).toBe(true)
    expect(ctx.activeWorktreePath).toBe('/Users/x/.hip/worktrees/r1/a')
    expect(ctx.runId).toBe('r1')
    expect(ctx.primaryPath).toBe('/repo')
  })

  it('3. active is host of runs → host = active, not isolated', () => {
    const runs = [
      run({
        id: 'r1',
        hostSessionId: 'host',
        slots: [
          {
            index: 0,
            sessionId: 'slot-a',
            worktreePath: '/Users/x/.hip/worktrees/r1/a',
            branch: 'b',
            status: 'ready',
          },
        ],
      }),
    ]
    const ctx = resolveWorktreeHostContext({
      activeSession: { id: 'host', config: { cwd: '/repo', surface: 'code' } },
      sessions: [
        { id: 'host', config: { cwd: '/repo' } },
        { id: 'slot-a', config: { cwd: '/Users/x/.hip/worktrees/r1/a' } },
      ],
      runs,
      catalog: catalog([
        { id: 'p', path: '/repo', isPrimary: true },
        { id: 'w1', path: '/Users/x/.hip/worktrees/r1/a', managed: true, hostSessionId: 'host' },
      ]),
    })
    expect(ctx.unresolved).toBe(false)
    expect(ctx.hostSessionId).toBe('host')
    expect(ctx.isOnIsolated).toBe(false)
    expect(ctx.activeWorktreePath).toBeUndefined()
    expect(ctx.primaryPath).toBe('/repo')
  })

  it('4. catalog non-primary with hostSessionId', () => {
    const ctx = resolveWorktreeHostContext({
      activeSession: {
        id: 'bound',
        config: { cwd: '/Users/x/.hip/worktrees/iso/feat', surface: 'code' },
      },
      sessions: [
        { id: 'host', config: { cwd: '/repo' } },
        { id: 'bound', config: { cwd: '/Users/x/.hip/worktrees/iso/feat' } },
      ],
      runs: [],
      catalog: catalog([
        { id: 'p', path: '/repo', isPrimary: true, repoKey: 'rk' },
        {
          id: 'iso',
          path: '/Users/x/.hip/worktrees/iso/feat',
          managed: true,
          hostSessionId: 'host',
          repoKey: 'rk',
          branch: 'hip-iso-x',
        },
      ]),
    })
    expect(ctx.unresolved).toBe(false)
    expect(ctx.hostSessionId).toBe('host')
    expect(ctx.isOnIsolated).toBe(true)
    expect(ctx.activeWorktreePath).toBe('/Users/x/.hip/worktrees/iso/feat')
  })

  it('4b. catalog non-primary without hostSessionId → primary session by path', () => {
    const ctx = resolveWorktreeHostContext({
      activeSession: {
        id: 'bound',
        config: { cwd: '/Users/x/.hip/worktrees/iso/feat', surface: 'code' },
      },
      sessions: [
        { id: 'host', config: { cwd: '/repo' } },
        { id: 'bound', config: { cwd: '/Users/x/.hip/worktrees/iso/feat' } },
      ],
      runs: [],
      catalog: catalog([
        { id: 'p', path: '/repo', isPrimary: true, repoKey: 'rk' },
        {
          id: 'iso',
          path: '/Users/x/.hip/worktrees/iso/feat',
          managed: true,
          repoKey: 'rk',
        },
      ]),
    })
    expect(ctx.unresolved).toBe(false)
    expect(ctx.hostSessionId).toBe('host')
    expect(ctx.primaryPath).toBe('/repo')
  })

  it('5. managed path without catalog: slot path match', () => {
    const runs = [
      run({
        id: 'r1',
        hostSessionId: 'host',
        slots: [
          {
            index: 0,
            sessionId: '',
            worktreePath: '/Users/x/.hip/worktrees/r1/orphan',
            branch: 'b',
            status: 'ready',
          },
        ],
      }),
    ]
    const ctx = resolveWorktreeHostContext({
      activeSession: {
        id: 'orphan-sess',
        config: { cwd: '/Users/x/.hip/worktrees/r1/orphan', surface: 'code' },
      },
      sessions: [
        { id: 'host', config: { cwd: '/repo' } },
        { id: 'orphan-sess', config: { cwd: '/Users/x/.hip/worktrees/r1/orphan' } },
      ],
      runs,
      catalog: [],
    })
    expect(ctx.unresolved).toBe(false)
    expect(ctx.hostSessionId).toBe('host')
    expect(ctx.isOnIsolated).toBe(true)
  })

  it('5b. managed path without catalog or run → unresolved no_host', () => {
    const ctx = resolveWorktreeHostContext({
      activeSession: {
        id: 'orphan',
        config: { cwd: '/Users/x/.hip/worktrees/alone/x', surface: 'code' },
      },
      sessions: [{ id: 'orphan', config: { cwd: '/Users/x/.hip/worktrees/alone/x' } }],
      runs: [],
      catalog: [],
    })
    expect(ctx.unresolved).toBe(true)
    expect(ctx.unresolvedReason).toBe('no_host')
    expect(ctx.isOnIsolated).toBe(true)
  })

  it('6. default: active with cwd not nested → host = active', () => {
    const ctx = resolveWorktreeHostContext({
      activeSession: { id: 'host', config: { cwd: '/repo', surface: 'code' } },
      sessions: [{ id: 'host', config: { cwd: '/repo' } }],
      runs: [],
      catalog: catalog([{ id: 'p', path: '/repo', isPrimary: true }]),
    })
    expect(ctx.unresolved).toBe(false)
    expect(ctx.hostSessionId).toBe('host')
    expect(ctx.isOnIsolated).toBe(false)
    expect(ctx.primaryPath).toBe('/repo')
  })

  it('no cwd → unresolved no_cwd', () => {
    const ctx = resolveWorktreeHostContext({
      activeSession: { id: 's', config: { surface: 'code' } },
      sessions: [{ id: 's', config: {} }],
      runs: [],
      catalog: [],
    })
    expect(ctx.unresolved).toBe(true)
    expect(ctx.unresolvedReason).toBe('no_cwd')
  })

  it('slot + missing host session + empty catalog → unresolved no_host', () => {
    const runs = [
      run({
        id: 'r1',
        hostSessionId: 'host-gone',
        slots: [
          {
            index: 0,
            sessionId: 'slot-a',
            worktreePath: '/Users/x/.hip/worktrees/r1/a',
            branch: 'hip-p-r1-0',
            status: 'ready',
          },
        ],
      }),
    ]
    const ctx = resolveWorktreeHostContext({
      activeSession: {
        id: 'slot-a',
        config: { cwd: '/Users/x/.hip/worktrees/r1/a', surface: 'code' },
      },
      sessions: [
        { id: 'slot-a', config: { cwd: '/Users/x/.hip/worktrees/r1/a' } },
        // host-gone intentionally absent
      ],
      runs,
      catalog: [],
    })
    expect(ctx.unresolved).toBe(true)
    expect(ctx.unresolvedReason).toBe('no_host')
    expect(ctx.primaryPath).toBeUndefined()
    expect(ctx.isOnIsolated).toBe(true)
    // Still surfaces candidate id for debugging / list attempt, but ops must not use isolated cwd as base
    expect(ctx.hostSessionId).toBe('host-gone')
  })

  it('host-of-run stays not isolated even if cwd matches a non-primary catalog path', () => {
    const runs = [
      run({
        id: 'r1',
        hostSessionId: 'host',
        slots: [
          {
            index: 0,
            sessionId: 'slot-a',
            worktreePath: '/Users/x/.hip/worktrees/r1/a',
            branch: 'b',
            status: 'ready',
          },
        ],
      }),
    ]
    // Pathological: host cwd equals a managed catalog path (should not flip isOnIsolated).
    const ctx = resolveWorktreeHostContext({
      activeSession: {
        id: 'host',
        config: { cwd: '/Users/x/.hip/worktrees/r1/a', surface: 'code' },
      },
      sessions: [
        { id: 'host', config: { cwd: '/Users/x/.hip/worktrees/r1/a' } },
        { id: 'slot-a', config: { cwd: '/Users/x/.hip/worktrees/r1/a' } },
      ],
      runs,
      catalog: catalog([
        { id: 'p', path: '/repo', isPrimary: true },
        {
          id: 'w1',
          path: '/Users/x/.hip/worktrees/r1/a',
          managed: true,
          hostSessionId: 'host',
        },
      ]),
    })
    expect(ctx.unresolved).toBe(false)
    expect(ctx.hostSessionId).toBe('host')
    expect(ctx.isOnIsolated).toBe(false)
    expect(ctx.activeWorktreePath).toBeUndefined()
    expect(ctx.primaryPath).toBe('/repo')
  })
})

describe('resolveWorktreeListCatalogHost', () => {
  const worktrees = [
    { path: '/repo', isPrimary: true },
    { path: '/Users/x/.hip/worktrees/forgejo-p1', isPrimary: false },
  ]

  it('keeps project host when list is requested from a nested worktree session', () => {
    const hostId = resolveWorktreeListCatalogHost({
      sessionId: 'wt-sess',
      worktrees,
      activeSession: {
        id: 'wt-sess',
        config: { cwd: '/Users/x/.hip/worktrees/forgejo-p1', surface: 'code' },
      },
      sessions: [
        { id: 'host', title: 'Host', config: { cwd: '/repo' } },
        {
          id: 'wt-sess',
          title: 'P1',
          config: { cwd: '/Users/x/.hip/worktrees/forgejo-p1' },
        },
      ],
      runs: [],
      catalog: catalog([
        { id: 'p', path: '/repo', isPrimary: true, hostSessionId: 'host' },
        {
          id: 'w1',
          path: '/Users/x/.hip/worktrees/forgejo-p1',
          managed: true,
          hostSessionId: 'host',
        },
      ]),
    })
    expect(hostId).toBe('host')
  })

  it('falls back to primary-cwd session when catalog host is empty', () => {
    const hostId = resolveWorktreeListCatalogHost({
      sessionId: 'wt-sess',
      worktrees,
      activeSession: {
        id: 'wt-sess',
        config: { cwd: '/Users/x/.hip/worktrees/forgejo-p1', surface: 'code' },
      },
      sessions: [
        { id: 'host', title: 'Host', config: { cwd: '/repo' } },
        {
          id: 'wt-sess',
          title: 'P1',
          config: { cwd: '/Users/x/.hip/worktrees/forgejo-p1' },
        },
      ],
      runs: [],
      catalog: catalog([
        { id: 'p', path: '/repo', isPrimary: true },
        { id: 'w1', path: '/Users/x/.hip/worktrees/forgejo-p1', managed: true },
      ]),
    })
    expect(hostId).toBe('host')
  })

  it('uses requester when it is already the project host', () => {
    const hostId = resolveWorktreeListCatalogHost({
      sessionId: 'host',
      worktrees,
      activeSession: { id: 'host', config: { cwd: '/repo', surface: 'code' } },
      sessions: [{ id: 'host', title: 'Host', config: { cwd: '/repo' } }],
      runs: [],
      catalog: catalog([{ id: 'p', path: '/repo', isPrimary: true, hostSessionId: 'host' }]),
    })
    expect(hostId).toBe('host')
  })

  it('recovers when catalog was already wrongly stamped with nested session id', () => {
    const hostId = resolveWorktreeListCatalogHost({
      sessionId: 'wt-sess',
      worktrees,
      activeSession: {
        id: 'wt-sess',
        config: { cwd: '/Users/x/.hip/worktrees/forgejo-p1', surface: 'code' },
      },
      sessions: [
        { id: 'host', title: 'Host', config: { cwd: '/repo' } },
        {
          id: 'wt-sess',
          title: 'P1',
          config: { cwd: '/Users/x/.hip/worktrees/forgejo-p1' },
        },
      ],
      runs: [],
      // Previous buggy list:result rebound everything to wt-sess.
      catalog: catalog([
        { id: 'p', path: '/repo', isPrimary: true, hostSessionId: 'wt-sess' },
        {
          id: 'w1',
          path: '/Users/x/.hip/worktrees/forgejo-p1',
          managed: true,
          hostSessionId: 'wt-sess',
        },
      ]),
    })
    expect(hostId).toBe('host')
  })
})
