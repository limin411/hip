import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { VerificationGate, GateContext, GateResult } from '../verification-gate.js'

const execAsync = promisify(exec)

const DIAGNOSTIC_RE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/gm

export const typecheckGate: VerificationGate = {
  kind: 'typecheck',
  description: 'Run tsc --noEmit and fail on type errors',

  async run(ctx: GateContext): Promise<GateResult> {
    const startedAt = Date.now()
    try {
      await execAsync('npx tsc --noEmit', { cwd: ctx.cwd, timeout: 120_000 })
      return {
        passed: true,
        failures: [],
        suggestions: [],
        durationMs: Date.now() - startedAt,
      }
    } catch (err: unknown) {
      const error = err as { stderr?: string; stdout?: string; message?: string }
      const stderr: string = error.stderr || error.stdout || ''
      const failures = parseTypeScriptErrors(stderr)
      return {
        passed: failures.length === 0,
        failures,
        suggestions: failures.length > 0
          ? ['Fix type errors above and re-run']
          : [],
        durationMs: Date.now() - startedAt,
      }
    }
  },
}

function parseTypeScriptErrors(output: string): GateResult['failures'] {
  const failures: GateResult['failures'] = []
  for (const m of output.matchAll(DIAGNOSTIC_RE)) {
    failures.push({
      file: m[1],
      line: parseInt(m[2], 10),
      message: `TS${m[5]}: ${m[6]}`,
      severity: m[4] === 'warning' ? 'warning' : 'error',
    })
  }
  return failures
}
