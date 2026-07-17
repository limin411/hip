/**
 * Pure path policy for managed worktrees.
 *
 * Nest-by-repo is parameterized via `nestByRepo` on the helpers below.
 * Production creates keep nest **off** until WorktreeService (PR2+) — see
 * `resolveManagedWorktreePath`, which always passes `nestByRepo: false`.
 *
 * Env name reserved for later wiring (NOT read in this module):
 *   HIP_WORKTREES_NEST — when WorktreeService lands (PR2+), `=1` opts into
 *   nest for new creates; default flip to on is PR2b. Do not honor the env
 *   for live create paths from these pure helpers.
 *
 * @see docs/design/2026-07-17-worktree-studio-orca-alignment.md (KD3, KD11, PR1)
 */
import * as path from 'node:path'
import { sanitizeRefComponent } from './workspace-git.js'

/**
 * Derive a short repo slug from a git root path for nest-by-repo layouts.
 * Uses the last 1–2 meaningful path segments (skips home-dir boilerplate and
 * dot-prefixed segments), joined by `-`. Falls back to `"repo"`.
 *
 * Mirrors grok-build `repo_slug` / Orca basename nesting intent; simple is OK.
 */
export function repoSlug(gitRoot: string): string {
  if (!gitRoot || !gitRoot.trim()) return 'repo'
  const components = path
    .resolve(gitRoot)
    .split(/[/\\]+/)
    .filter((s) => s.length > 0 && s !== 'home' && s !== 'Users' && !s.startsWith('.'))
    .map((s) => s.replace(/\.git$/i, ''))
    .filter(Boolean)
  if (components.length === 0) return 'repo'
  const take = Math.min(2, components.length)
  const raw = components.slice(-take).join('-')
  const slug = sanitizeRefComponent(raw)
  return slug || 'repo'
}

/**
 * Ensure `targetPath` resolves inside `workspaceDir` (no path traversal).
 * Returns the resolved absolute target path, or throws on escape.
 * Same contract as Orca `ensurePathWithinWorkspace`.
 */
export function ensurePathWithinWorkspace(targetPath: string, workspaceDir: string): string {
  const resolvedWorkspaceDir = path.resolve(workspaceDir)
  const resolvedTargetPath = path.resolve(targetPath)
  const rel = path.relative(resolvedWorkspaceDir, resolvedTargetPath)
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) {
    throw new Error('Invalid worktree path')
  }
  return resolvedTargetPath
}

export interface ComputeManagedWorktreePathOpts {
  /** Managed worktrees root (e.g. getWorktreesDir()). */
  worktreesDir: string
  /** Optional multi-segment key (e.g. runId/branch); falls back to branch. */
  pathKey?: string
  /** Branch name used when pathKey is empty / for empty-parts fallback. */
  branch: string
  /** Git primary root; used only when nestByRepo is true. */
  gitRoot?: string
  /**
   * When true: `worktreesDir/<repoSlug>/<pathKey…>`.
   * When false: `worktreesDir/<pathKey…>` (current product default).
   * Callers that serve live creates must pass false until WorktreeService
   * reads HIP_WORKTREES_NEST (PR2+). This module never reads that env.
   */
  nestByRepo: boolean
}

/**
 * Compute a managed worktree absolute path under `worktreesDir`.
 * pathKey / branch segments are always sanitized (never raw `/` nest).
 * Does **not** read HIP_WORKTREES_NEST — pass nestByRepo explicitly.
 */
export function computeManagedWorktreePath(opts: ComputeManagedWorktreePathOpts): string {
  const key = (opts.pathKey && opts.pathKey.trim()) || opts.branch
  const parts = key.split(/[/\\]+/).filter(Boolean).map((p) => sanitizeRefComponent(p))
  if (parts.length === 0) parts.push(sanitizeRefComponent(opts.branch))
  const base = opts.nestByRepo
    ? path.join(opts.worktreesDir, repoSlug(opts.gitRoot ?? ''))
    : opts.worktreesDir
  return path.join(base, ...parts)
}
