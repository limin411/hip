import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import {
  repoSlug,
  ensurePathWithinWorkspace,
  computeManagedWorktreePath,
} from './worktree-paths.js'
import { resolveManagedWorktreePath } from './workspace-git.js'
import { sanitizeRefComponent } from './ref-sanitize.js'
import { getWorktreesDir } from './worktree-config.js'

/**
 * HIP_WORKTREES_NEST is documented for WorktreeService (PR2+) only.
 * These pure helpers never read process.env.HIP_WORKTREES_NEST — nest is an
 * explicit parameter so unit tests can cover on/off without env wiring.
 */
describe('repoSlug', () => {
  it('uses last 1–2 meaningful segments joined by -', () => {
    expect(repoSlug('/Users/alice/my-github/hip')).toBe('my-github-hip')
    expect(repoSlug('/home/bob/projects/hip')).toBe('projects-hip')
  })

  it('skips home boilerplate and dot-prefixed segments', () => {
    expect(repoSlug('/Users/alice/.local/share/hip')).toBe('share-hip')
    expect(repoSlug('/home/alice/hip')).toBe('alice-hip')
  })

  it('strips .git suffix and falls back to repo', () => {
    expect(repoSlug('/var/repos/app.git')).toBe('repos-app')
    expect(repoSlug('')).toBe('repo')
    expect(repoSlug('   ')).toBe('repo')
  })

  it('single meaningful segment when only one remains', () => {
    expect(repoSlug('/hip')).toBe('hip')
  })
})

describe('ensurePathWithinWorkspace', () => {
  const workspace = path.resolve('/tmp/hip-worktrees')

  it('returns resolved path when target is inside workspace', () => {
    const target = path.join(workspace, 'run-1', 'slot-a')
    expect(ensurePathWithinWorkspace(target, workspace)).toBe(path.resolve(target))
  })

  it('allows the workspace root itself', () => {
    expect(ensurePathWithinWorkspace(workspace, workspace)).toBe(path.resolve(workspace))
  })

  it('allows trailing separators on workspace and/or target (root)', () => {
    const withSep = workspace + path.sep
    expect(ensurePathWithinWorkspace(withSep, workspace)).toBe(path.resolve(workspace))
    expect(ensurePathWithinWorkspace(workspace, withSep)).toBe(path.resolve(workspace))
    expect(ensurePathWithinWorkspace(withSep, withSep)).toBe(path.resolve(workspace))
  })

  it('rejects path traversal outside managed dir', () => {
    expect(() =>
      ensurePathWithinWorkspace(path.join(workspace, '..', 'escape'), workspace),
    ).toThrow(/Invalid worktree path/)
    expect(() =>
      ensurePathWithinWorkspace('/etc/passwd', workspace),
    ).toThrow(/Invalid worktree path/)
    expect(() =>
      ensurePathWithinWorkspace(path.join(workspace, '..'), workspace),
    ).toThrow(/Invalid worktree path/)
  })

  it('rejects sibling prefix attack (startsWith footgun)', () => {
    // /tmp/hip-worktrees-evil is NOT under /tmp/hip-worktrees
    expect(() =>
      ensurePathWithinWorkspace(workspace + '-evil', workspace),
    ).toThrow(/Invalid worktree path/)
    expect(() =>
      ensurePathWithinWorkspace(workspace + '-evil' + path.sep + 'slot', workspace),
    ).toThrow(/Invalid worktree path/)
  })

  it('rejects relative target that resolves outside workspace', () => {
    // path.resolve(cwd, '../…') from workspace-adjacent relative form
    const outsideRel = path.relative(process.cwd(), path.join(workspace, '..', 'escape'))
    expect(path.isAbsolute(outsideRel)).toBe(false)
    expect(() =>
      ensurePathWithinWorkspace(outsideRel, workspace),
    ).toThrow(/Invalid worktree path/)
  })

  it('allows legitimate child name starting with .. (not parent traversal)', () => {
    const child = path.join(workspace, '..foo')
    expect(ensurePathWithinWorkspace(child, workspace)).toBe(path.resolve(child))
  })
})

describe('computeManagedWorktreePath', () => {
  const worktreesDir = '/tmp/hip-wt-root'
  const underManaged = (p: string) => {
    const root = path.resolve(worktreesDir)
    const resolved = path.resolve(p)
    expect(resolved === root || resolved.startsWith(root + path.sep)).toBe(true)
  }

  it('nestByRepo=false joins worktreesDir + sanitized pathKey (legacy flat)', () => {
    const p = computeManagedWorktreePath({
      worktreesDir,
      pathKey: 'run-abc/slot-1',
      branch: 'hip-p-x-1',
      nestByRepo: false,
    })
    expect(p).toBe(path.join(worktreesDir, 'run-abc', 'slot-1'))
  })

  it('nestByRepo=true nests under repoSlug(gitRoot)', () => {
    const p = computeManagedWorktreePath({
      worktreesDir,
      pathKey: 'run-abc/slot-1',
      branch: 'hip-p-x-1',
      gitRoot: '/Users/alice/my-github/hip',
      nestByRepo: true,
    })
    expect(p).toBe(path.join(worktreesDir, 'my-github-hip', 'run-abc', 'slot-1'))
  })

  it('falls back to branch when pathKey empty', () => {
    const flat = computeManagedWorktreePath({
      worktreesDir,
      branch: 'feature',
      nestByRepo: false,
    })
    expect(flat).toBe(path.join(worktreesDir, 'feature'))

    const nested = computeManagedWorktreePath({
      worktreesDir,
      branch: 'feature',
      gitRoot: '/Users/alice/hip',
      nestByRepo: true,
    })
    expect(nested).toBe(path.join(worktreesDir, 'alice-hip', 'feature'))
  })

  it('sanitizes unsafe pathKey segments', () => {
    const p = computeManagedWorktreePath({
      worktreesDir,
      pathKey: 'a/b .c',
      branch: 'fallback',
      nestByRepo: false,
    })
    const expectedSeg = sanitizeRefComponent('b .c')
    expect(p).toBe(path.join(worktreesDir, 'a', expectedSeg))
  })

  it('sanitizes .. pathKey segments so join cannot escape worktreesDir', () => {
    const dotDot = computeManagedWorktreePath({
      worktreesDir,
      pathKey: '..',
      branch: 'fallback',
      nestByRepo: false,
    })
    underManaged(dotDot)
    expect(dotDot).toBe(path.join(worktreesDir, sanitizeRefComponent('..')))
    expect(dotDot).not.toBe(path.join(worktreesDir, '..'))

    const escape = computeManagedWorktreePath({
      worktreesDir,
      pathKey: '../escape',
      branch: 'fallback',
      nestByRepo: false,
    })
    underManaged(escape)
    expect(escape).toBe(
      path.join(worktreesDir, sanitizeRefComponent('..'), sanitizeRefComponent('escape')),
    )
    // Must not collapse to worktreesDir/escape via join traversal
    expect(escape).not.toBe(path.join(worktreesDir, 'escape'))

    const middle = computeManagedWorktreePath({
      worktreesDir,
      pathKey: 'a/../b',
      branch: 'fallback',
      nestByRepo: false,
    })
    underManaged(middle)
    expect(middle).toBe(
      path.join(worktreesDir, 'a', sanitizeRefComponent('..'), 'b'),
    )
  })

  it('keeps absolute-looking pathKey under worktreesDir (leading empty segment dropped)', () => {
    const p = computeManagedWorktreePath({
      worktreesDir,
      pathKey: '/etc/passwd',
      branch: 'fallback',
      nestByRepo: false,
    })
    // split(/[/\\]+/).filter(Boolean) → ['etc', 'passwd'] — not an absolute path
    expect(p).toBe(path.join(worktreesDir, 'etc', 'passwd'))
    expect(path.isAbsolute(p)).toBe(true)
    underManaged(p)
    expect(p).not.toBe('/etc/passwd')
  })

  it('nestByRepo=true without gitRoot nests under repo fallback', () => {
    const p = computeManagedWorktreePath({
      worktreesDir,
      pathKey: 'slot',
      branch: 'b',
      nestByRepo: true,
    })
    expect(p).toBe(path.join(worktreesDir, 'repo', 'slot'))
  })

  it('does not read HIP_WORKTREES_NEST (env ignored by pure helper)', () => {
    const prev = process.env.HIP_WORKTREES_NEST
    try {
      process.env.HIP_WORKTREES_NEST = '1'
      const p = computeManagedWorktreePath({
        worktreesDir,
        pathKey: 'k',
        branch: 'b',
        gitRoot: '/Users/alice/hip',
        nestByRepo: false,
      })
      // nestByRepo false wins — env must not force nest
      expect(p).toBe(path.join(worktreesDir, 'k'))
      expect(p).not.toContain('alice-hip')
    } finally {
      if (prev === undefined) delete process.env.HIP_WORKTREES_NEST
      else process.env.HIP_WORKTREES_NEST = prev
    }
  })
})

describe('resolveManagedWorktreePath (live create path — nest always off)', () => {
  it('matches legacy flat join (nest=false path identical to today)', () => {
    const withKey = resolveManagedWorktreePath('run-abc/slot-1', 'hip-p-x-1')
    expect(withKey).toBe(path.join(getWorktreesDir(), 'run-abc', 'slot-1'))

    const withBranch = resolveManagedWorktreePath(undefined, 'feature')
    expect(withBranch).toBe(path.join(getWorktreesDir(), 'feature'))
  })

  it('ignores HIP_WORKTREES_NEST for production resolve helper', () => {
    const prev = process.env.HIP_WORKTREES_NEST
    try {
      process.env.HIP_WORKTREES_NEST = '1'
      const p = resolveManagedWorktreePath('run-x/slot', 'branch')
      expect(p).toBe(path.join(getWorktreesDir(), 'run-x', 'slot'))
    } finally {
      if (prev === undefined) delete process.env.HIP_WORKTREES_NEST
      else process.env.HIP_WORKTREES_NEST = prev
    }
  })
})
