import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { VerificationGate, GateContext, GateResult } from '../verification-gate.js'

const execAsync = promisify(exec)

const FAIL_RE = /(FAIL|ERROR)\s+(.+?)(?::(.+))?\n/g

export const testGate: VerificationGate = {
  kind: 'test',
  description: 'Run vitest and fail on test failures',

  async run(ctx: GateContext): Promise<GateResult> {
    const startedAt = Date.now()
    const command = (ctx.config?.command as string) ?? 'npx vitest run'
    try {
      await execAsync(command, { cwd: ctx.cwd, timeout: 300_000 })
      return { passed: true, failures: [], suggestions: [], durationMs: Date.now() - startedAt }
    } catch (err: unknown) {
      const error = err as { stderr?: string; stdout?: string; message?: string }
      const output = error.stdout || error.stderr || ''
      const failures: GateResult['failures'] = []
      for (const m of output.matchAll(FAIL_RE)) {
        failures.push({ message: `${m[1]}: ${m[2]}${m[3] ? ' - ' + m[3] : ''}`, severity: 'error' })
      }
      if (failures.length === 0) {
        failures.push({ message: 'Tests failed (parse error). Run vitest manually for details.', severity: 'error' })
      }
      return {
        passed: false,
        failures,
        suggestions: ['Fix failing tests and re-run'],
        durationMs: Date.now() - startedAt,
      }
    }
  },
}
