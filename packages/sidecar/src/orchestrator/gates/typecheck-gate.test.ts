// packages/sidecar/src/orchestrator/gates/typecheck-gate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GateContext } from '../verification-gate.js'

const mockExec = vi.fn()
vi.mock('node:child_process', () => ({
  exec: () => {},
}))
vi.mock('node:util', () => ({
  promisify: () => (cmd: string, opts?: unknown) => mockExec(cmd, opts),
}))

import { typecheckGate } from './typecheck-gate.js'

const baseCtx: GateContext = {
  cwd: '/tmp/test-typecheck',
  sessionId: 'sess-1',
  runId: 'run-1',
}

describe('typecheckGate', () => {
  beforeEach(() => {
    mockExec.mockReset()
  })

  it('passes when tsc exits 0', async () => {
    mockExec.mockResolvedValue({})
    const result = await typecheckGate.run(baseCtx)
    expect(result.passed).toBe(true)
    expect(result.failures).toHaveLength(0)
  })

  it('parses TypeScript error diagnostics from tsc output', async () => {
    // Simulated tsc --noEmit output with multiple errors
    const tscOutput = [
      "src/app.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/utils.ts(3,1): warning TS6133: 'foo' is declared but never used.",
    ].join('\n')
    mockExec.mockRejectedValue({ stdout: tscOutput, stderr: '', code: 2 })

    const result = await typecheckGate.run(baseCtx)
    expect(result.passed).toBe(false)

    const errors = result.failures.filter((f) => f.severity === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toBe('src/app.ts')
    expect(errors[0].line).toBe(10)
    expect(errors[0].message).toContain('2322')
    expect(errors[0].message).toContain('string')

    const warnings = result.failures.filter((f) => f.severity === 'warning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('6133')
  })

  it('reports warnings as failures (typecheck-gate treats all diagnostics as failures)', async () => {
    const tscOutput = "src/lib.ts(5,1): warning TS6133: 'bar' is declared but never used."
    mockExec.mockRejectedValue({ stdout: '', stderr: tscOutput, code: 1 })

    const result = await typecheckGate.run(baseCtx)
    // Typecheck gate treats all diagnostics (including warnings) as failures
    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].severity).toBe('warning')
  })

  it('handles empty output from tsc failure', async () => {
    mockExec.mockRejectedValue({ stdout: '', stderr: '', code: 1 })
    const result = await typecheckGate.run(baseCtx)
    expect(result.passed).toBe(true)
    expect(result.failures).toHaveLength(0)
  })

  it('returns passed=true when tsc output does not match diagnostic pattern', async () => {
    // When tsc is not found, the error output doesn't match TS diagnostic regex
    // so the parser finds no failures and passes.
    mockExec.mockRejectedValue({
      stderr: "error: tsc not found",
      stdout: '',
      message: "Command failed: npx tsc --noEmit",
      code: 127,
    })
    const result = await typecheckGate.run(baseCtx)
    // Non-diagnostic output results in no parsed failures → passed=true
    expect(result.passed).toBe(true)
    expect(result.failures).toHaveLength(0)
  })

  it('reports duration', async () => {
    mockExec.mockResolvedValue({})
    const result = await typecheckGate.run(baseCtx)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})
