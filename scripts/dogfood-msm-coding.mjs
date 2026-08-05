#!/usr/bin/env node
/**
 * Real-LLM coding dogfood on make-stock-money via product CLI (hip run).
 *
 * Usage:
 *   eval "$(scripts/hip-eval-bootstrap-msm.sh)"
 *   yarn dogfood:msm -- --task msm-multi-file-db
 *   yarn dogfood:msm -- --scenario watchlist
 *   yarn dogfood:msm -- --task msm-longrun-watchlist
 *
 * Env:
 *   HIP_EVAL_MSM_PATH   primary checkout (required)
 *   OUT_DIR             report directory
 *   DOGFOOD_TIMEOUT_SEC default 1800 (longrun 3600)
 *   E2E_EVAL_KEEP_WORKSPACE=1  keep worktree
 *   HIP_PROVIDER / HIP_MODEL
 */
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const packDir = path.join(repoRoot, 'e2e/eval/tasks/make-stock-money')
const scenariosDir = path.join(packDir, 'scenarios')

const msm =
  process.env.HIP_EVAL_MSM_PATH ||
  '/Users/lijiamin/data/code-repository/project-rust/make-stock-money'

function parseArgs(argv) {
  const out = { task: null, scenario: null, list: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--task') out.task = argv[++i]
    else if (a === '--scenario') out.scenario = argv[++i]
    else if (a === '--list') out.list = true
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  console.log(`dogfood-msm-coding.mjs
  --list                 list tasks and scenarios
  --task <id>            run pack task (worktree + hip run + verify)
  --scenario <name>      free-form scenario md stem (watchlist|probe-hardening|ui-datasource-ux)
`)
  process.exit(0)
}

if (args.list) {
  const { loadPack } = await import(pathToFileURL(path.join(repoRoot, 'e2e/eval/load-task.ts')).href)
  const { pack, tasks } = loadPack(packDir)
  console.log('pack', pack.id)
  for (const t of tasks) console.log('  task', t.id, t.level, t.name)
  for (const f of fs.readdirSync(scenariosDir).filter((x) => x.endsWith('.md'))) {
    console.log('  scenario', f.replace(/\.md$/, ''))
  }
  process.exit(0)
}

if (!args.task && !args.scenario) {
  console.error('pass --task <id> or --scenario <name> (or --list)')
  process.exit(2)
}

const outDir =
  process.env.OUT_DIR || path.join(os.tmpdir(), `msm-coding-eval-${Date.now()}`)
fs.mkdirSync(outDir, { recursive: true })
process.env.HIP_EVAL_MSM_PATH = msm

const defaultTimeout = args.task === 'msm-longrun-watchlist' || args.scenario ? 3600 : 1800
const timeoutSec = Number(process.env.DOGFOOD_TIMEOUT_SEC || defaultTimeout)

const report = {
  msm,
  outDir,
  startedAt: new Date().toISOString(),
  ok: false,
  mode: args.task ? 'task' : 'scenario',
  taskId: args.task || null,
  scenario: args.scenario || null,
}

function writeReport() {
  report.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  process.stdout.write(
    JSON.stringify({ ok: report.ok, outDir, error: report.error, taskId: report.taskId }, null, 2) +
      '\n',
  )
}

function extractScenarioPrompt(mdPath) {
  const text = fs.readFileSync(mdPath, 'utf8')
  const m = text.match(/```(?:text)?\n([\s\S]*?)```/)
  if (!m) throw new Error(`no fenced prompt block in ${mdPath}`)
  return m[1].trim()
}

try {
  if (!fs.existsSync(msm)) throw new Error(`HIP_EVAL_MSM_PATH missing: ${msm}`)

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
  report.packId = pack.id

  let task
  let prompt

  if (args.task) {
    task = tasks.find((t) => t.id === args.task)
    if (!task) throw new Error(`task not found: ${args.task}`)
    prompt = task.prompt
    if (task.workspace.setup?.kind === 'patch') {
      checkPatchApplies(
        msm,
        task.workspace.base_sha ?? 'HEAD',
        path.join(packDir, task.workspace.setup.path),
      )
    }
  } else {
    const scenPath = path.join(scenariosDir, `${args.scenario}.md`)
    if (!fs.existsSync(scenPath)) throw new Error(`scenario not found: ${scenPath}`)
    // Longrun template task for workspace defaults + verify
    task = tasks.find((t) => t.id === 'msm-longrun-watchlist')
    if (!task) throw new Error('msm-longrun-watchlist missing from pack')
    // clone task with none setup + scenario prompt
    task = {
      ...task,
      id: `msm-scenario-${args.scenario}`,
      prompt: extractScenarioPrompt(scenPath),
      workspace: { ...task.workspace, setup: { kind: 'none' } },
    }
    prompt = task.prompt
    report.scenarioFile = scenPath
  }

  report.taskId = task.id
  const primaryBefore = snapshotPrimary(msm)
  report.primaryBefore = primaryBefore

  const workspace = prepareWorkspace(task, { packDir, keep: true })
  report.workspace = {
    runId: workspace.runId,
    cwd: workspace.cwd,
    branch: workspace.branch,
    baseSha: workspace.baseSha,
  }

  // Pre-verify: patch tasks should fail tests before agent
  if (task.workspace.setup?.kind === 'patch') {
    const pre = spawnSync(
      'cargo',
      ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--', '--test-threads=1'],
      { cwd: workspace.cwd, encoding: 'utf8', timeout: 300_000 },
    )
    report.preVerify = {
      exitCode: pre.status,
      stdoutTail: (pre.stdout || '').slice(-2000),
      stderrTail: (pre.stderr || '').slice(-2000),
    }
    if (pre.status === 0) {
      throw new Error('pre-condition: cargo test should fail after break patch')
    }
  }

  const hipOutDir = path.join(outDir, 'hip-run')
  fs.mkdirSync(hipOutDir, { recursive: true })
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
    timeout: (timeoutSec + 120) * 1000,
    env: { ...process.env, FORCE_COLOR: '0' },
    maxBuffer: 40 * 1024 * 1024,
  })
  fs.writeFileSync(path.join(outDir, 'cli-stdout.log'), run.stdout || '')
  fs.writeFileSync(path.join(outDir, 'cli-stderr.log'), run.stderr || '')
  report.cli = {
    status: run.status,
    signal: run.signal,
    error: run.error ? String(run.error) : undefined,
  }

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

  const primaryAfter = snapshotPrimary(msm)
  report.primaryAfter = primaryAfter
  report.primaryMutated = primaryMutated(primaryBefore, primaryAfter)

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

  // Long-run metrics (plan M4)
  report.metrics = {
    wallMs: Date.now() - Date.parse(report.startedAt),
    verifyPass: verifyOk,
    primaryMutated: report.primaryMutated,
    changeNonempty: report.changeNonempty,
    cliStatus: run.status,
  }

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
    report.keepHint = workspace.cwd
  }
} catch (err) {
  report.ok = false
  report.error = err instanceof Error ? err.message : String(err)
}

writeReport()
process.exit(report.ok ? 0 : 1)
