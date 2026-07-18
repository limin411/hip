import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
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
    const e = err as { status?: number; stderr?: string; message?: string; stdout?: string }
    if (e.status === 127 || (e.message && /ENOENT|not found/i.test(e.message))) {
      return { ok: false, error: 'git binary not found' }
    }
    return { ok: false, error: e.stderr?.toString() || e.message || String(err) }
  }
}

/**
 * Like runGit, but treats exit code 1 with stdout as success (git diff --no-index
 * exits 1 when files differ).
 */
function runGitDiff(cwd: string, args: string[]): { ok: true; out: string } | { ok: false; error: string } {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    })
    return { ok: true, out: out.trimEnd() }
  } catch (err) {
    const e = err as { status?: number; stderr?: string; message?: string; stdout?: string | Buffer }
    if (e.status === 127 || (e.message && /ENOENT|not found/i.test(e.message))) {
      return { ok: false, error: 'git binary not found' }
    }
    // git diff returns 1 when differences exist
    if (e.status === 1 && e.stdout != null) {
      return { ok: true, out: String(e.stdout).trimEnd() }
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

/**
 * Build a unified patch of the working tree vs HEAD for tracked files, plus
 * untracked files as new-file hunks.
 *
 * Uses a single `git diff HEAD` (worktree vs HEAD). Do NOT also append
 * `git diff --cached HEAD`: when status is MM (e.g. eval `git apply --index`
 * then agent edits worktree only), cached and worktree diffs contradict.
 */
export function buildWorktreePatch(cwd: string): { ok: true; patch: string } | { ok: false; error: string } {
  // Tracked: worktree contents vs HEAD (one coherent view of final files).
  const diff = runGitDiff(cwd, ['diff', 'HEAD'])
  if (!diff.ok) {
    return { ok: false, error: diff.error }
  }

  let patch = diff.out

  // Untracked (respect .gitignore): append new-file diffs without mutating index.
  const untracked = runGit(cwd, ['ls-files', '--others', '--exclude-standard'])
  if (!untracked.ok) {
    // Best-effort: return tracked patch even if untracked listing fails
    return { ok: true, patch }
  }
  for (const rel of untracked.out.split('\n').map((s) => s.trim()).filter(Boolean)) {
    // Skip paths that are not readable files (dirs handled poorly by --no-index)
    const abs = isAbsolute(rel) ? rel : join(cwd, rel)
    if (!existsSync(abs)) continue
    try {
      // Prefer git's new-file diff when possible
      const u = runGitDiff(cwd, ['diff', '--no-index', '--', '/dev/null', rel])
      if (u.ok && u.out) {
        if (patch && !patch.endsWith('\n')) patch += '\n'
        if (patch) patch += '\n'
        patch += u.out
        continue
      }
    } catch {
      /* fall through */
    }
    // Fallback: minimal unified diff for text
    try {
      const body = readFileSync(abs, 'utf8')
      const repoRel = relative(cwd, abs).replace(/\\/g, '/') || rel
      const lines = body.split('\n')
      // trailing newline handling for hunk count
      const endsWithNl = body.endsWith('\n')
      const contentLines = endsWithNl && body.length > 0 ? lines.slice(0, -1) : lines
      const hunk =
        `diff --git a/${repoRel} b/${repoRel}\n` +
        `new file mode 100644\n` +
        `--- /dev/null\n` +
        `+++ b/${repoRel}\n` +
        `@@ -0,0 +1,${Math.max(contentLines.length, 1)} @@\n` +
        contentLines.map((l) => `+${l}`).join('\n') +
        (contentLines.length ? '\n' : '')
      if (patch && !patch.endsWith('\n')) patch += '\n'
      if (patch) patch += '\n'
      patch += hunk
    } catch {
      /* skip unreadable */
    }
  }

  return { ok: true, patch }
}

/** Post-run: dirtyAfter + worktree-vs-HEAD patch (+ optional write patch file). */
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

  const built = buildWorktreePatch(cwd)
  if (!built.ok) {
    return {
      git: {
        isRepo: true,
        dirtyBefore: baseline.dirtyBefore,
        dirtyAfter,
        patchStatus: 'failed',
        patchError: built.error,
      },
    }
  }

  const patch = built.patch
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
      patchStatus: 'written',
    },
    patch: patchPath,
  }
}
