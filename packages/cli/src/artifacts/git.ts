import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { HipRunResult } from '../types.js'

export interface GitSnapshot {
  isRepo: boolean
  dirtyBefore: boolean
  head?: string
  error?: string
}

function runGit(cwd: string, args: string[]): { ok: true; out: string } | { ok: false; error: string } {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    })
    return { ok: true, out: out.trimEnd() }
  } catch (err) {
    const e = err as { status?: number; stderr?: string; message?: string }
    if (e.status === 127 || (e.message && /ENOENT|not found/i.test(e.message))) {
      return { ok: false, error: 'git binary not found' }
    }
    return { ok: false, error: e.stderr?.toString() || e.message || String(err) }
  }
}

/** Capture pre-run git state. */
export function captureGitBaseline(cwd: string): GitSnapshot {
  const head = runGit(cwd, ['rev-parse', 'HEAD'])
  if (!head.ok) {
    if (/not a git repository/i.test(head.error)) {
      return { isRepo: false, dirtyBefore: false }
    }
    if (/git binary not found/i.test(head.error)) {
      return { isRepo: false, dirtyBefore: false, error: 'no_git' }
    }
    // not a repo often returns exit 128
    if (/fatal: not a git repository/i.test(head.error) || /unknown revision/i.test(head.error)) {
      return { isRepo: false, dirtyBefore: false }
    }
    // rev-parse fails on empty repo without commits — still a repo
    const check = runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
    if (!check.ok || check.out.trim() !== 'true') {
      return { isRepo: false, dirtyBefore: false, error: head.error }
    }
  }

  const status = runGit(cwd, ['status', '--porcelain'])
  if (!status.ok) {
    return {
      isRepo: true,
      dirtyBefore: false,
      head: head.ok ? head.out.trim() : undefined,
      error: status.error,
    }
  }
  return {
    isRepo: true,
    dirtyBefore: status.out.trim().length > 0,
    head: head.ok ? head.out.trim() : undefined,
  }
}

export type PatchStatus = NonNullable<HipRunResult['git']>['patchStatus']

export interface GitAfterResult {
  git: NonNullable<HipRunResult['git']>
  patch?: string
}

/** Post-run: dirtyAfter + full git diff HEAD (+ optional write patch file). */
export function captureGitAfter(
  cwd: string,
  baseline: GitSnapshot,
  opts: { outDir?: string; requireGit?: boolean } = {},
): GitAfterResult {
  if (baseline.error === 'no_git') {
    return {
      git: {
        isRepo: false,
        dirtyBefore: false,
        patchStatus: 'skipped_no_git',
        patchError: 'git binary not found',
      },
    }
  }
  if (!baseline.isRepo) {
    return {
      git: {
        isRepo: false,
        dirtyBefore: false,
        patchStatus: 'skipped_not_repo',
      },
    }
  }

  const status = runGit(cwd, ['status', '--porcelain'])
  const dirtyAfter = status.ok ? status.out.trim().length > 0 : false
  const diff = runGit(cwd, ['diff', 'HEAD'])
  // include untracked roughly: also staged
  const diffCached = runGit(cwd, ['diff', '--cached', 'HEAD'])
  let patch = ''
  if (diff.ok) patch += diff.out
  if (diffCached.ok && diffCached.out) {
    if (patch && !patch.endsWith('\n')) patch += '\n'
    patch += diffCached.out
  }

  if (!diff.ok && !diffCached.ok) {
    return {
      git: {
        isRepo: true,
        dirtyBefore: baseline.dirtyBefore,
        dirtyAfter,
        patchStatus: 'failed',
        patchError: diff.error || diffCached.error,
      },
    }
  }

  let patchPath: string | undefined
  if (opts.outDir) {
    mkdirSync(opts.outDir, { recursive: true })
    patchPath = join(opts.outDir, 'patch.diff')
    writeFileSync(patchPath, patch || '', 'utf8')
  }

  return {
    git: {
      isRepo: true,
      dirtyBefore: baseline.dirtyBefore,
      dirtyAfter,
      patchStatus: opts.outDir ? 'written' : 'written',
    },
    patch: patchPath,
  }
}
