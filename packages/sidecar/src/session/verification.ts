/**
 * Goal verification recipe: detect project commands + run them.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GoalManager } from './goal.js'
import type { VerificationRecipe, VerificationResultItem, VerificationRunResult } from './goal-types.js'

export function detectVerificationRecipe(cwd: string | undefined | null): VerificationRecipe | undefined {
  if (!cwd) return undefined
  const commands: VerificationRecipe['commands'] = []

  const tauriManifest = join(cwd, 'src-tauri', 'Cargo.toml')
  if (existsSync(tauriManifest)) {
    commands.push({
      id: 'cargo-test',
      cmd: 'cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1',
    })
    return { commands }
  }

  if (existsSync(join(cwd, 'Cargo.toml'))) {
    commands.push({ id: 'cargo-test', cmd: 'cargo test -- --test-threads=1' })
    return { commands }
  }

  const pkgPath = join(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }
      const scripts = pkg.scripts ?? {}
      if (scripts['type-check']) {
        commands.push({ id: 'type-check', cmd: 'yarn type-check' })
      } else if (scripts['typecheck']) {
        commands.push({ id: 'typecheck', cmd: 'yarn typecheck' })
      }
      if (scripts.test) {
        commands.push({ id: 'test', cmd: 'yarn test' })
      }
    } catch {
      /* ignore */
    }
    if (commands.length) return { commands }
  }

  if (existsSync(join(cwd, 'go.mod'))) {
    commands.push({ id: 'go-test', cmd: 'go test ./... -count=1 -timeout 120s' })
    return { commands }
  }

  return undefined
}

export function ensureGoalVerification(goalManager: GoalManager, cwd?: string | null): void {
  const goal = goalManager.getStatus()
  if (!goal) return
  if (goal.verification?.commands?.length) return
  const detected = detectVerificationRecipe(cwd)
  if (detected) goalManager.setVerification(detected)
}

function splitCmd(cmd: string): string[] {
  // simple split; recipes use space-separated argv without fancy quoting
  return cmd.trim().split(/\s+/).filter(Boolean)
}

export function runVerificationRecipe(
  recipe: VerificationRecipe,
  cwd: string,
  timeoutSec = 300,
): VerificationRunResult {
  const at = Date.now()
  const results: VerificationResultItem[] = []
  for (const c of recipe.commands) {
    const parts = splitCmd(c.cmd)
    if (parts.length === 0) continue
    const workDir = c.cwd ? join(cwd, c.cwd) : cwd
    const started = Date.now()
    const res = spawnSync(parts[0], parts.slice(1), {
      cwd: workDir,
      encoding: 'utf8',
      timeout: timeoutSec * 1000,
      env: process.env,
    })
    const exitCode = res.status ?? (res.error ? 1 : 0)
    const stdout = res.stdout ?? ''
    const stderr = res.stderr ?? ''
    results.push({
      id: c.id,
      cmd: c.cmd,
      exitCode,
      durationMs: Date.now() - started,
      ok: exitCode === 0,
      stdoutTail: stdout.slice(-2000),
      stderrTail: stderr.slice(-2000),
    })
    if (exitCode !== 0) {
      // stop on first failure
      break
    }
  }
  return {
    ok: results.length > 0 && results.every((r) => r.ok),
    at,
    results,
  }
}

export function formatVerificationDetail(result: VerificationRunResult): string {
  const lines = [
    `Verification ${result.ok ? 'PASSED' : 'FAILED'}`,
    ...result.results.map(
      (r) =>
        `- ${r.ok ? 'ok' : 'FAIL'} ${r.cmd} (exit ${r.exitCode}, ${r.durationMs}ms)` +
        (r.ok ? '' : `\n  stderr: ${(r.stderrTail || '').slice(-500)}`),
    ),
  ]
  return lines.join('\n')
}

export async function runGoalVerification(
  goalManager: GoalManager,
  cwd: string | undefined | null,
): Promise<{ ok: boolean; detail: string }> {
  ensureGoalVerification(goalManager, cwd)
  const goal = goalManager.getStatus()
  if (!goal) return { ok: false, detail: 'No goal' }
  if (!cwd) return { ok: false, detail: 'No workspace cwd' }
  const recipe = goal.verification
  if (!recipe?.commands?.length) {
    return { ok: false, detail: 'No verification recipe detected for this project' }
  }
  const result = runVerificationRecipe(recipe, cwd)
  goalManager.recordVerification(result)
  if (!result.ok) {
    for (const r of result.results) {
      if (!r.ok) goalManager.recordFailureFingerprint(`${r.cmd}#${r.exitCode}`)
    }
  }
  return { ok: result.ok, detail: formatVerificationDetail(result) }
}
