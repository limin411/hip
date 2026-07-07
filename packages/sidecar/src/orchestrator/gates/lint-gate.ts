import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { VerificationGate, GateContext, GateResult } from '../verification-gate.js'

const execAsync = promisify(exec)

export const lintGate: VerificationGate = {
  kind: 'lint',
  description: 'Run eslint and fail on lint errors',

  async run(ctx: GateContext): Promise<GateResult> {
    const startedAt = Date.now()
    const command = (ctx.config?.command as string) ?? 'npx eslint . --format json'
    try {
      await execAsync(command, { cwd: ctx.cwd, timeout: 120_000 })
      return { passed: true, failures: [], suggestions: [], durationMs: Date.now() - startedAt }
    } catch (err: unknown) {
      const error = err as { stderr?: string; stdout?: string; message?: string; code?: number }

      // eslint exits 1 on lint errors — parse JSON output
      try {
        const results: unknown[] = JSON.parse(error.stdout || '[]')
        const failures = results.flatMap((r: any) =>
          r.messages.map((m: any) => ({
            file: r.filePath as string | undefined,
            line: m.line as number | undefined,
            message: `${m.ruleId ?? 'syntax'}: ${m.message}`,
            severity: (m.severity === 1 ? 'warning' : 'error') as 'error' | 'warning',
          }))
        )
        return {
          passed: failures.filter((f: GateResult['failures'][number]) => f.severity === 'error').length === 0,
          failures,
          suggestions: failures.length > 0 ? ['Run eslint --fix to auto-correct some issues'] : [],
          durationMs: Date.now() - startedAt,
        }
      } catch {
        return {
          passed: false,
          failures: [{ message: error.stderr || error.message || 'Unknown error', severity: 'error' }],
          suggestions: ['Ensure eslint is installed and configured'],
          durationMs: Date.now() - startedAt,
        }
      }
    }
  },
}
