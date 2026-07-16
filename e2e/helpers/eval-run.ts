import * as fs from 'node:fs'
import * as path from 'node:path'
import { CodePage } from '../page-objects/CodePage.js'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from './app.js'
import { skipLoginIfPresent } from './auth.js'
import { sendEvalPrompt, waitForTurnSettle, getLastAssistantTextReadOnly } from './eval-composer.js'
import { pumpPermissionsUntil, setPermissionModeUi, permissionModalOpen } from './eval-permissions.js'
import { selectPanelTab } from './panel.js'
import { switchToCodeSurface } from './surface.js'
import { diffFileTexts } from './git-workspace.js'
import { captureInventory, inventoryDelta } from '../eval/inventory.js'
import { writeRunReport, writeTextArtifact, reportDir } from '../eval/report.js'
import { scoreRun } from '../eval/taxonomy.js'
import { runVerifyCommands } from '../eval/verify.js'
import {
  cleanupWorkspace,
  prepareWorkspace,
  primaryMutated,
  snapshotPrimary,
} from '../eval/workspace.js'
import type {
  PackManifest,
  PreparedWorkspace,
  RunReport,
  ScoreResult,
  TaskSpec,
  UiTurnOutcome,
} from '../eval/types.js'
import { loadPack, loadTask } from '../eval/load-task.js'

const codePage = new CodePage()

export async function ensureCodeAppReady(): Promise<void> {
  await waitForAppReady()
  await skipLoginIfPresent()
  await waitForMainApp()
  await leaveSpecialViewsIfOpen()
  await switchToCodeSurface()
}

/** Bind FolderPill to directory via product click + dialog stub. */
export async function bindFolderViaUi(dir: string): Promise<void> {
  await codePage.newConversation.waitForExist({ timeout: 120000 })
  await codePage.pickDirectory(dir)
  await codePage.folderChip.waitForExist({ timeout: 30000 })
  const text = await codePage.folderChip.getText()
  const base = path.basename(dir)
  if (!text.includes(base)) {
    throw new Error(`ui_bind_fail: folder chip "${text}" does not include "${base}"`)
  }
}

export async function captureChangesPaths(): Promise<string[]> {
  try {
    await selectPanelTab('changes')
    await (await browser.$('[data-testid="changes-view"]')).waitForExist({ timeout: 15000 })
  } catch {
    return []
  }
  const joined = await diffFileTexts()
  return joined
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

export interface EvalRunResult {
  report: RunReport
  score: ScoreResult
  workspace?: PreparedWorkspace
}

/**
 * Full eval run: prepare worktree → UI agent turn → inventory → verify → score → report.
 * For @live @eval specs.
 */
export async function runEvalTask(opts: {
  task: TaskSpec
  packDir: string
  packId?: string
  keep?: boolean
}): Promise<EvalRunResult> {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  let workspace: PreparedWorkspace | undefined
  let prepareError: string | undefined

  try {
    workspace = prepareWorkspace(opts.task, {
      packDir: opts.packDir,
      keep: opts.keep,
    })
  } catch (err) {
    prepareError = err instanceof Error ? err.message : String(err)
  }

  const runId = workspace?.runId ?? `failed-${Date.now()}`
  const outDir = reportDir(runId)
  fs.mkdirSync(outDir, { recursive: true })

  if (!workspace) {
    const uiOutcome: UiTurnOutcome = {
      settled: false,
      timedOut: false,
      assistantText: '',
      changesPaths: [],
      permissionModalStuck: false,
      awaitingUser: false,
      errorHints: [prepareError ?? 'prepare failed'],
    }
    const score = scoreRun({
      prepareOk: false,
      prepareError,
      ui: uiOutcome,
      inventory: { dirtyAfter: false, paths: [], fullPatch: '', trackedPatch: '' },
      verify: { ran: false, results: [] },
      primaryMutated: false,
    })
    const report = buildReport({
      runId,
      task: opts.task,
      packId: opts.packId ?? 'unknown',
      startedAt,
      t0,
      workspace: null,
      uiOutcome,
      inventory: { dirtyAfter: false, paths: [], fullPatch: '', trackedPatch: '' },
      verify: { ran: false, results: [] },
      score,
      primaryAfter: { porcelain: '', head: '' },
      outDir,
    })
    writeRunReport(report)
    return { report, score }
  }

  const timeoutMs = opts.task.ui.timeout_ms ?? 900_000
  const autoApprove = opts.task.ui.auto_approve_permissions !== false
  const mode = opts.task.ui.permission_mode ?? 'edit'

  await ensureCodeAppReady()
  await bindFolderViaUi(workspace.cwd)

  try {
    await setPermissionModeUi(mode)
  } catch {
    // default is edit; continue if chip missing
  }

  // Baseline AFTER setup patch (fixture dirt must not count as agent work)
  const baselineInventory = captureInventory(workspace.cwd)
  writeTextArtifact(runId, 'baseline-paths.txt', baselineInventory.paths.join('\n'))

  await sendEvalPrompt(opts.task.prompt)

  let approved = 0
  let interruptResumes = 0
  const settle = await waitForTurnSettle({
    timeoutMs,
    userPrompt: opts.task.prompt,
    stableMs: 3000,
    onTick: async () => {
      if (autoApprove && (await permissionModalOpen())) {
        const r = await pumpPermissionsUntil(Date.now() + 5_000, true)
        approved += r.approvedCount
      }
      // Agent interrupt / ask-user pause has no Allow button — resume with a short reply (max 2×)
      if (autoApprove && interruptResumes < 2) {
        const hasInterrupt = await browser.execute(() =>
          Boolean(document.querySelector('[data-testid="chat-interrupt"]')),
        )
        if (hasInterrupt) {
          interruptResumes += 1
          try {
            await sendEvalPrompt(
              interruptResumes === 1
                ? 'Please continue and finish the task without asking further questions.'
                : 'Continue. Complete the remaining work now.',
            )
          } catch {
            // ignore send failures mid-turn
          }
          await browser.pause(800)
        }
      }
    },
  })

  // final permission pump
  const perm = await pumpPermissionsUntil(Date.now() + 2_000, autoApprove)
  approved += perm.approvedCount

  const assistantText = await getLastAssistantTextReadOnly()
  const changesPaths = await captureChangesPaths()
  const stuck = await permissionModalOpen()

  const awaitingUser = await browser.execute(() => {
    return Boolean(
      document.querySelector('[data-testid="plan-approval-card"]') ||
        document.querySelector('[data-testid="chat-interrupt"]') ||
        document.querySelector('[data-testid="agent-interrupt"]'),
    )
  })

  const hints: string[] = []
  if (approved) hints.push(`permissions_approved=${approved}`)
  if (interruptResumes) hints.push(`interrupt_resumes=${interruptResumes}`)
  if (!settle.sawRunning) hints.push('never_saw_running')
  if (settle.timedOut) hints.push('turn_timeout')

  const uiOutcome: UiTurnOutcome = {
    settled: settle.settled && settle.sawRunning && !settle.timedOut,
    timedOut: settle.timedOut || !settle.sawRunning,
    assistantText,
    changesPaths,
    permissionModalStuck: stuck,
    awaitingUser,
    errorHints: hints,
  }

  const afterInventory = captureInventory(workspace.cwd)
  // Score agent delta vs post-setup baseline (fixture-only dirt is not "agent change")
  const inventory = inventoryDelta(baselineInventory, afterInventory)
  writeTextArtifact(runId, 'full-patch.diff', afterInventory.fullPatch)
  writeTextArtifact(runId, 'tracked-patch.diff', afterInventory.trackedPatch)
  writeTextArtifact(runId, 'agent-paths.txt', inventory.paths.join('\n'))
  writeTextArtifact(runId, 'assistant.txt', assistantText)
  writeTextArtifact(runId, 'changes-ui.txt', changesPaths.join('\n'))

  const verify = runVerifyCommands(opts.task, workspace.cwd, outDir)
  const primaryAfter = snapshotPrimary(workspace.repoPath)
  const mutated = primaryMutated(workspace.primaryGuardBefore, primaryAfter)

  // ui_changes_missing only if *agent* changed disk but Changes UI empty
  const score = scoreRun({
    prepareOk: true,
    ui: uiOutcome,
    inventory,
    verify: {
      ran: verify.ran,
      skippedReason: verify.skippedReason,
      results: verify.results,
    },
    primaryMutated: mutated,
    expect: opts.task.ui.expect,
    soft: opts.task.verify?.soft,
  })

  const report = buildReport({
    runId,
    task: opts.task,
    packId: opts.packId ?? 'unknown',
    startedAt,
    t0,
    workspace,
    uiOutcome,
    inventory,
    verify,
    score,
    primaryAfter,
    outDir,
  })
  writeRunReport(report)

  if (!workspace.kept) {
    cleanupWorkspace({
      repoPath: workspace.repoPath,
      cwd: workspace.cwd,
      branch: workspace.branch,
      keep: false,
    })
  }

  return { report, score, workspace }
}

function buildReport(args: {
  runId: string
  task: TaskSpec
  packId: string
  startedAt: string
  t0: number
  workspace: PreparedWorkspace | null
  uiOutcome: UiTurnOutcome
  inventory: RunReport['changes']
  verify: { ran: boolean; skippedReason?: string; results: RunReport['verify']['results'] }
  score: ScoreResult
  primaryAfter: { porcelain: string; head: string }
  outDir: string
  ui?: unknown
}): RunReport {
  const finishedAt = new Date().toISOString()
  const ws = args.workspace
  return {
    schemaVersion: 1,
    runId: args.runId,
    taskId: args.task.id,
    packId: args.packId,
    startedAt: args.startedAt,
    finishedAt,
    durationMs: Date.now() - args.t0,
    workspace: {
      strategy: ws?.strategy ?? 'worktree',
      repoPath: ws?.repoPath ?? '',
      cwd: ws?.cwd ?? '',
      baseSha: ws?.baseSha ?? '',
      kept: ws?.kept ?? false,
      primaryGuard: {
        beforePorcelain: ws?.primaryGuardBefore.porcelain ?? '',
        afterPorcelain: args.primaryAfter.porcelain,
        headBefore: ws?.primaryGuardBefore.head ?? '',
        headAfter: args.primaryAfter.head,
        mutated: ws
          ? primaryMutated(ws.primaryGuardBefore, {
              porcelain: args.primaryAfter.porcelain,
              head: args.primaryAfter.head,
            })
          : false,
      },
    },
    ui: args.uiOutcome,
    changes: args.inventory,
    verify: {
      ran: args.verify.ran,
      skippedReason: args.verify.skippedReason,
      passed: args.score.verifyPassed,
      results: args.verify.results,
    },
    score: args.score,
    artifacts: {
      dir: args.outDir,
      report: path.join(args.outDir, 'run-report.json'),
    },
  }
}

export function loadBytebasePilotPack(): { pack: PackManifest; packDir: string; tasks: TaskSpec[] } {
  const packDir = path.resolve('e2e/eval/tasks/bytebase-pilot')
  return loadPack(packDir)
}

export function loadTaskFromPack(packDir: string, taskFile: string): TaskSpec {
  const { tasks } = loadPack(packDir)
  const t = tasks.find((x) => x.id === taskFile || taskFile.endsWith(`${x.id}.json`))
  if (t) return t
  return loadTask(path.join(packDir, taskFile))
}
