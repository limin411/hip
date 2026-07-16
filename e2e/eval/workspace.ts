import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { PreparedWorkspace, PrimaryGuardSnapshot, TaskSpec, WorkspaceStrategy } from './types.js'
import { resolvePackRelative, resolveTaskRepoPath } from './load-task.js'

export function evalRoot(): string {
  return process.env.HIP_EVAL_ROOT || path.join(os.homedir(), '.hip', 'eval-runs')
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  }).trimEnd()
}

function tryRunGit(cwd: string, args: string[]): { ok: true; out: string } | { ok: false; error: string } {
  try {
    return { ok: true, out: runGit(cwd, args) }
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string }
    const stderr = e.stderr ? String(e.stderr) : ''
    return { ok: false, error: stderr || e.message || String(err) }
  }
}

export function snapshotPrimary(repoPath: string): PrimaryGuardSnapshot {
  const porcelain = tryRunGit(repoPath, ['status', '--porcelain'])
  const head = tryRunGit(repoPath, ['rev-parse', 'HEAD'])
  return {
    porcelain: porcelain.ok ? porcelain.out : `ERROR:${porcelain.error}`,
    head: head.ok ? head.out : `ERROR:${head.error}`,
  }
}

export function primaryMutated(before: PrimaryGuardSnapshot, after: PrimaryGuardSnapshot): boolean {
  return before.porcelain !== after.porcelain || before.head !== after.head
}

function sanitizeBranchPart(s: string): string {
  return s.replace(/[^a-zA-Z0-9._/-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

export function newRunId(taskId: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const rnd = randomBytes(3).toString('hex')
  return `${sanitizeBranchPart(taskId)}-${stamp}-${rnd}`
}

export interface PrepareOptions {
  packDir: string
  keep?: boolean
  /** Override run id (tests). */
  runId?: string
}

/**
 * Prepare an isolated worktree for a task.
 * Sequence: resolve base_sha → worktree add -b → optional setup patch.
 */
export function prepareWorkspace(task: TaskSpec, opts: PrepareOptions): PreparedWorkspace {
  const strategy: WorkspaceStrategy = task.workspace.strategy ?? 'worktree'
  if (strategy === 'copy') {
    throw new Error('workspace strategy "copy" not implemented in MVP')
  }
  if ((strategy as string) === 'inplace') {
    throw new Error('workspace strategy "inplace" is forbidden')
  }

  const repoPath = resolveTaskRepoPath(task)
  if (!fs.existsSync(repoPath)) {
    throw new Error(`repo_path does not exist: ${repoPath}`)
  }

  const inside = tryRunGit(repoPath, ['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok || inside.out !== 'true') {
    throw new Error(`not a git repo: ${repoPath}`)
  }

  const pin = task.workspace.base_sha || task.workspace.base_ref || 'HEAD'
  const baseShaResult = tryRunGit(repoPath, ['rev-parse', pin])
  if (!baseShaResult.ok) {
    throw new Error(`failed to resolve base ${pin}: ${baseShaResult.error}`)
  }
  const baseSha = baseShaResult.out

  const runId = opts.runId ?? newRunId(task.id)
  const branch = `hip-eval/${sanitizeBranchPart(task.id)}/${sanitizeBranchPart(runId)}`
  const wtPath = path.join(evalRoot(), 'worktrees', runId)

  fs.mkdirSync(path.dirname(wtPath), { recursive: true })
  if (fs.existsSync(wtPath)) {
    throw new Error(`worktree path already exists: ${wtPath}`)
  }

  const primaryGuardBefore = snapshotPrimary(repoPath)

  const add = tryRunGit(repoPath, ['worktree', 'add', '-b', branch, wtPath, baseSha])
  if (!add.ok) {
    throw new Error(`git worktree add failed: ${add.error}`)
  }

  const setup = task.workspace.setup
  if (setup?.kind === 'patch') {
    const patchPath = resolvePackRelative(opts.packDir, setup.path)
    if (!fs.existsSync(patchPath)) {
      cleanupWorkspace({ repoPath, cwd: wtPath, branch, keep: false })
      throw new Error(`setup patch not found: ${patchPath}`)
    }
    const apply = tryRunGit(wtPath, ['apply', '--index', patchPath])
    if (!apply.ok) {
      // try without --index
      const apply2 = tryRunGit(wtPath, ['apply', patchPath])
      if (!apply2.ok) {
        cleanupWorkspace({ repoPath, cwd: wtPath, branch, keep: false })
        throw new Error(`git apply failed: ${apply2.error}`)
      }
    }
  } else if (setup?.kind === 'script') {
    cleanupWorkspace({ repoPath, cwd: wtPath, branch, keep: false })
    throw new Error('setup.kind script not implemented in MVP')
  }

  return {
    runId,
    taskId: task.id,
    strategy: 'worktree',
    repoPath,
    cwd: wtPath,
    baseSha,
    branch,
    primaryGuardBefore,
    kept: Boolean(opts.keep ?? process.env.E2E_EVAL_KEEP_WORKSPACE === '1'),
  }
}

export function cleanupWorkspace(ws: {
  repoPath: string
  cwd: string
  branch: string
  keep: boolean
}): void {
  if (ws.keep) return
  tryRunGit(ws.repoPath, ['worktree', 'remove', '--force', ws.cwd])
  tryRunGit(ws.repoPath, ['branch', '-D', ws.branch])
  // If remove failed, try rm
  if (fs.existsSync(ws.cwd)) {
    try {
      fs.rmSync(ws.cwd, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
}

/** Create a tiny throwaway git repo for unpaid smoke (no Bytebase). */
export function createTempGitRepo(label = 'hip-eval-smoke'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`))
  runGit(dir, ['init'])
  runGit(dir, ['config', 'user.email', 'eval@hip.local'])
  runGit(dir, ['config', 'user.name', 'hip-eval'])
  fs.writeFileSync(path.join(dir, 'README.md'), '# eval smoke\n')
  runGit(dir, ['add', 'README.md'])
  runGit(dir, ['commit', '-m', 'init'])
  return dir
}

/** Check patch applies cleanly on a pin without mutating (uses temp worktree). */
export function checkPatchApplies(repoPath: string, baseSha: string, patchPath: string): void {
  const runId = newRunId('apply-check')
  const branch = `hip-eval/check/${runId}`
  const wtPath = path.join(evalRoot(), 'worktrees', runId)
  fs.mkdirSync(path.dirname(wtPath), { recursive: true })
  const add = tryRunGit(repoPath, ['worktree', 'add', '-b', branch, wtPath, baseSha])
  if (!add.ok) throw new Error(`apply-check worktree add failed: ${add.error}`)
  try {
    const check = tryRunGit(wtPath, ['apply', '--check', patchPath])
    if (!check.ok) throw new Error(`git apply --check failed: ${check.error}`)
  } finally {
    cleanupWorkspace({ repoPath, cwd: wtPath, branch, keep: false })
  }
}
