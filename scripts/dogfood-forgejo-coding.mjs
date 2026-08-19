#!/usr/bin/env node
/**
 * Real-LLM coding dogfood on forgejo via product CLI path (hip run).
 * Sequence: prepareWorkspace (eval worktree) → hip run → go test verify → primary-guard.
 *
 * Usage:
 *   HIP_EVAL_FORGEJO_PATH=… OUT_DIR=… node --import tsx scripts/dogfood-forgejo-coding.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const forgejo = process.env.HIP_EVAL_FORGEJO_PATH
if (!forgejo) {
  console.error('Set HIP_EVAL_FORGEJO_PATH to your Forgejo checkout.')
  process.exit(2)
}
const outDir =
  process.env.OUT_DIR ||
  path.join(os.tmpdir(), `forgejo-coding-eval-${Date.now()}`)
const packDir = path.join(repoRoot, 'e2e/eval/tasks/forgejo')
const timeoutSec = Number(process.env.DOGFOOD_TIMEOUT_SEC || 900)

fs.mkdirSync(outDir, { recursive: true })
process.env.HIP_EVAL_FORGEJO_PATH = forgejo

const report = {
  forgejo,
  outDir,
  startedAt: new Date().toISOString(),
  ok: false,
}

function writeReport() {
  report.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  process.stdout.write(JSON.stringify({ ok: report.ok, outDir, error: report.error }, null, 2) + '\n')
}

try {
  const loadTaskUrl = pathToFileURL(path.join(repoRoot, 'e2e/eval/load-task.ts')).href
  const workspaceUrl = pathToFileURL(path.join(repoRoot, 'e2e/eval/workspace.ts')).href
  const verifyUrl = pathToFileURL(path.join(repoRoot, 'e2e/eval/verify.ts')).href
  const { loadPack } = await import(loadTaskUrl)
  const {
    prepareWorkspace,
    cleanupWorkspace,
    snapshotPrimary,
    primaryMutated,
    checkPatchApplies,
  } = await import(workspaceUrl)
  const { runVerifyCommands } = await import(verifyUrl)

  const { pack, tasks } = loadPack(packDir)
  const task = tasks.find((t) => t.id === 'fj-util-fix-truncate-runes')
  if (!task) throw new Error('task not found')
  report.taskId = task.id
  report.packId = pack.id

  checkPatchApplies(
    forgejo,
    task.workspace.base_sha ?? 'HEAD',
    path.join(packDir, 'fixtures/break-truncate-runes.patch'),
  )

  const primaryBefore = snapshotPrimary(forgejo)
  report.primaryBefore = primaryBefore

  const workspace = prepareWorkspace(task, { packDir, keep: true })
  report.workspace = {
    runId: workspace.runId,
    cwd: workspace.cwd,
    branch: workspace.branch,
    baseSha: workspace.baseSha,
  }

  // Confirm broken state before agent
  const preTest = spawnSync(
    'go',
    ['test', './modules/util/', '-count=1', '-timeout', '60s', '-run', 'TestTruncateRunes'],
    { cwd: workspace.cwd, encoding: 'utf8', timeout: 90_000 },
  )
  report.preVerify = {
    exitCode: preTest.status,
    stdout: (preTest.stdout || '').slice(-2000),
    stderr: (preTest.stderr || '').slice(-2000),
  }
  if (preTest.status === 0) {
    throw new Error('pre-condition: TestTruncateRunes should fail after break patch')
  }

  const hipOutDir = path.join(outDir, 'hip-run')
  fs.mkdirSync(hipOutDir, { recursive: true })
  const prompt = task.prompt
  // Product CLI path: yarn workspace @hip/cli dev run (uses real auth when --use-user-hip)
  const cliArgs = [
    'workspace',
    '@hip/cli',
    'dev',
    'run',
    prompt,
    '--cwd',
    workspace.cwd,
    '--preset',
    'harness',
    '--use-user-hip',
    '--permission-mode',
    'full',
    '--hitl',
    'auto',
    '--json',
    '--out-dir',
    hipOutDir,
    '--timeout',
    String(timeoutSec),
    '--provider',
    process.env.HIP_PROVIDER || 'deepseek',
    '--model',
    process.env.HIP_MODEL || 'deepseek-chat',
  ]
  report.cliCmd = ['yarn', ...cliArgs]
  const run = spawnSync('yarn', cliArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: (timeoutSec + 60) * 1000,
    env: { ...process.env, FORCE_COLOR: '0' },
    maxBuffer: 20 * 1024 * 1024,
  })
  fs.writeFileSync(path.join(outDir, 'cli-stdout.log'), run.stdout || '')
  fs.writeFileSync(path.join(outDir, 'cli-stderr.log'), run.stderr || '')
  report.cli = {
    status: run.status,
    signal: run.signal,
    error: run.error ? String(run.error) : undefined,
  }

  // Parse last JSON line from stdout if present
  try {
    const lines = (run.stdout || '').trim().split('\n').filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        report.hipResult = JSON.parse(lines[i])
        break
      } catch {
        /* continue */
      }
    }
  } catch {
    /* ignore */
  }

  const verify = runVerifyCommands(task, workspace.cwd, outDir)
  report.verify = {
    ran: verify.ran,
    skippedReason: verify.skippedReason,
    results: verify.results?.map((r) => ({
      cmd: r.cmd,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      logPath: r.logPath,
      stdoutTail: (r.stdout || '').slice(-1500),
      stderrTail: (r.stderr || '').slice(-1500),
    })),
  }

  const primaryAfter = snapshotPrimary(forgejo)
  report.primaryAfter = primaryAfter
  report.primaryMutated = primaryMutated(primaryBefore, primaryAfter)

  // Inventory changes in worktree
  let dirty = ''
  try {
    dirty = execFileSync('git', ['status', '--porcelain'], {
      cwd: workspace.cwd,
      encoding: 'utf8',
    })
  } catch (e) {
    dirty = String(e)
  }
  report.worktreeDirty = dirty
  report.changeNonempty = dirty.trim().length > 0

  const verifyOk =
    verify.ran &&
    (verify.results ?? []).length > 0 &&
    (verify.results ?? []).every((r) => r.exitCode === 0)

  report.ok = Boolean(verifyOk && !report.primaryMutated && report.changeNonempty)

  if (!report.ok) {
    report.error = [
      !verifyOk ? 'verify_failed' : null,
      report.primaryMutated ? 'primary_mutated' : null,
      !report.changeNonempty ? 'empty_change' : null,
      run.status !== 0 ? `cli_exit_${run.status}` : null,
    ]
      .filter(Boolean)
      .join(',')
  }

  // Cleanup unless keep
  if (process.env.E2E_EVAL_KEEP_WORKSPACE !== '1') {
    cleanupWorkspace({
      repoPath: workspace.repoPath,
      cwd: workspace.cwd,
      branch: workspace.branch,
      keep: false,
    })
    report.cleaned = true
  } else {
    report.cleaned = false
  }
} catch (err) {
  report.ok = false
  report.error = err instanceof Error ? err.message : String(err)
}

writeReport()
process.exit(report.ok ? 0 : 1)
