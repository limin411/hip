import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { VerificationGate, GateContext, GateResult } from '../verification-gate.js'

const execAsync = promisify(exec)

export const scriptGate: VerificationGate = {
  kind: 'script',
  description: 'Run an arbitrary shell command. Passes on exit 0.',

  async run(ctx: GateContext): Promise<GateResult> {
    const startedAt = Date.now()
    const command = ctx.config?.command as string | undefined
    if (!command) {
      return {
        passed: false,
        failures: [{ message: 'script gate requires config.command', severity: 'error' }],
        suggestions: ['Provide a command in gate config'],
        durationMs: 0,
      }
    }
    try {
      const { stdout } = await execAsync(command, {
        cwd: ctx.cwd,
        timeout: (ctx.config?.timeoutMs as number) ?? 120_000,
      })
      return {
        passed: true,
        failures: [],
        suggestions: stdout.trim() ? [stdout.trim()] : [],
        durationMs: Date.now() - startedAt,
      }
    } catch (err: unknown) {
      const error = err as { stderr?: string; stdout?: string; message?: string; code?: number }
      return {
        passed: false,
        failures: [{
          message: error.stderr || error.message || `Command "${command}" failed with exit code ${error.code}`,
          severity: 'error',
        }],
        suggestions: [],
        durationMs: Date.now() - startedAt,
      }
    }
  },
}
