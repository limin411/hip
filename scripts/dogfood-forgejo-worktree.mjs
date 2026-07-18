#!/usr/bin/env node
/**
 * Real-machine dogfood: WorktreeService create/list/remove on forgejo primary.
 * Drives shipped sidecar worktree pipeline (not reimplemented).
 *
 * Usage:
 *   HIP_EVAL_FORGEJO_PATH=/path/to/forgejo node scripts/dogfood-forgejo-worktree.mjs
 *   OUT=/path/to/out.json node scripts/dogfood-forgejo-worktree.mjs
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import { realpathSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Realpath when possible (macOS /var → /private/var). */
function real(p) {
  try {
    return realpathSync(path.resolve(p))
  } catch {
    return path.resolve(p)
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const forgejo =
  process.env.HIP_EVAL_FORGEJO_PATH ||
  '/Users/lijiamin/data/code-repository/project-go/forgejo'
const outPath =
  process.env.OUT ||
  path.join(os.tmpdir(), `forgejo-worktree-dogfood-${Date.now()}.json`)

function snap(cwd) {
  const porcelain = execFileSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
  }).trimEnd()
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  }).trim()
  return { porcelain, head }
}

const worktreesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-dogfood-wt-'))
process.env.HIP_WORKTREES_DIR = worktreesDir
process.env.HIP_WORKTREES_NEST = process.env.HIP_WORKTREES_NEST ?? '1'

// Load shipped service via tsx-compatible dynamic import of compiled or source.
// Prefer source through node --import tsx when available.
const serviceUrl = pathToFileURL(
  path.join(repoRoot, 'packages/sidecar/src/session/worktree-service.ts'),
).href

const report = {
  forgejo,
  worktreesDir,
  startedAt: new Date().toISOString(),
  steps: [],
  ok: false,
}

try {
  if (!fs.existsSync(forgejo)) {
    throw new Error(`forgejo path missing: ${forgejo}`)
  }
  const primaryBefore = snap(forgejo)
  report.primaryBefore = primaryBefore

  const { createWorktreeService } = await import(serviceUrl)
  const gitModUrl = pathToFileURL(
    path.join(repoRoot, 'packages/sidecar/src/session/workspace-git.ts'),
  ).href
  const { gitCreateBranch } = await import(gitModUrl)
  const svc = createWorktreeService({})
  const runId = `dogfood-${Date.now().toString(36)}`
  const slots = []

  for (let i = 1; i <= 2; i++) {
    // Match product parallel branch shape (hip-p-*) used by host + agent paths.
    const branch = `hip-p-${runId.slice(0, 8)}-${i}`
    const pathKey = `${runId}/slot-${i}`
    const br = await gitCreateBranch(forgejo, branch)
    report.steps.push({ op: 'branch', index: i, branch, ...br })
    if (!br.ok && !/already exists/i.test(br.error ?? '')) {
      throw new Error(`create branch ${branch} failed: ${br.error ?? 'unknown'}`)
    }
    const created = await svc.create({
      cwd: forgejo,
      branch,
      pathKey,
      source: 'host_parallel',
      hostSessionId: `dogfood-${runId}`,
      parallelRunId: runId,
      label: `dogfood-slot-${i}`,
      reveal: false,
    })
    report.steps.push({ op: 'create', index: i, ...created })
    if (!created.ok || !created.path) {
      throw new Error(`create slot ${i} failed: ${created.error ?? 'unknown'}`)
    }
    if (!fs.existsSync(created.path)) {
      throw new Error(`slot path missing on disk: ${created.path}`)
    }
    if (!created.path.startsWith(worktreesDir)) {
      throw new Error(`slot not under managed root: ${created.path} vs ${worktreesDir}`)
    }
    if (path.resolve(created.path) === path.resolve(forgejo)) {
      throw new Error('slot path collides with primary forgejo cwd')
    }
    slots.push({ index: i, path: created.path, branch, id: created.worktree?.id })
  }

  const listed = await svc.list({ cwd: forgejo, managedOnly: true, hideEphemeral: true })
  report.steps.push({
    op: 'list',
    ok: listed.ok,
    count: listed.worktrees?.length,
    paths: listed.worktrees?.map((w) => w.path),
  })
  if (!listed.ok) throw new Error(`list failed: ${listed.error}`)
  for (const s of slots) {
    const found = listed.worktrees.some((w) => real(w.path) === real(s.path))
    if (!found) throw new Error(`list missing slot ${s.path}`)
  }

  // Dirty preflight: write file in slot1, non-force remove must fail
  const dirtyFile = path.join(slots[0].path, 'HIP_DOGFOOD_DIRTY.txt')
  fs.writeFileSync(dirtyFile, 'dirty\n')
  const dirtyRemove = await svc.remove({
    cwd: forgejo,
    worktreePath: slots[0].path,
    force: false,
  })
  report.steps.push({ op: 'remove_dirty_noforce', ...dirtyRemove })
  if (dirtyRemove.ok) {
    throw new Error('dirty remove without force should fail')
  }
  if (!/dirty|uncommitted/i.test(dirtyRemove.error ?? '')) {
    throw new Error(`expected dirty preflight error, got: ${dirtyRemove.error}`)
  }
  if (!fs.existsSync(slots[0].path)) {
    throw new Error('dirty non-force remove must leave worktree on disk')
  }

  // Force cleanup both slots
  for (const s of slots) {
    const rem = await svc.remove({
      cwd: forgejo,
      worktreePath: s.path,
      force: true,
    })
    report.steps.push({ op: 'remove_force', path: s.path, ...rem })
    if (!rem.ok) throw new Error(`force remove failed for ${s.path}: ${rem.error}`)
    if (fs.existsSync(s.path)) {
      throw new Error(`orphan worktree remains: ${s.path}`)
    }
  }

  // Drop leftover branches from primary
  for (const s of slots) {
    try {
      execFileSync('git', ['branch', '-D', s.branch], {
        cwd: forgejo,
        stdio: 'ignore',
      })
    } catch {
      /* branch may already be gone */
    }
  }

  const primaryAfter = snap(forgejo)
  report.primaryAfter = primaryAfter
  report.primaryMutated =
    primaryBefore.porcelain !== primaryAfter.porcelain ||
    primaryBefore.head !== primaryAfter.head
  if (report.primaryMutated) {
    throw new Error(
      `primary mutated: before=${JSON.stringify(primaryBefore)} after=${JSON.stringify(primaryAfter)}`,
    )
  }

  report.slots = slots
  report.ok = true
  report.finishedAt = new Date().toISOString()
} catch (err) {
  report.ok = false
  report.error = err instanceof Error ? err.message : String(err)
  report.finishedAt = new Date().toISOString()
} finally {
  try {
    fs.rmSync(worktreesDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
process.stdout.write(JSON.stringify({ ok: report.ok, outPath, error: report.error }, null, 2) + '\n')
process.exit(report.ok ? 0 : 1)
