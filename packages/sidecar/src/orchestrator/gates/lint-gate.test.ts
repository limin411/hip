// packages/sidecar/src/orchestrator/gates/lint-gate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GateContext } from '../verification-gate.js'

const mockExec = vi.fn()
vi.mock('node:child_process', () => ({
  exec: () => {},
}))
vi.mock('node:util', () => ({
  promisify: () => (cmd: string, opts?: unknown) => mockExec(cmd, opts),
}))

import { lintGate } from './lint-gate.js'

const baseCtx: GateContext = {
  cwd: '/tmp/test-lint',
  sessionId: 'sess-1',
  runId: 'run-1',
}

describe('lintGate', () => {
  beforeEach(() => {
    mockExec.mockReset()
  })

  it('passes when eslint exits 0', async () => {
    mockExec.mockResolvedValue({})
    const result = await lintGate.run(baseCtx)
    expect(result.passed).toBe(true)
    expect(result.failures).toHaveLength(0)
  })

  it('parses eslint JSON output on failure and extracts error messages', async () => {
    const eslintOutput = JSON.stringify([
      {
        filePath: '/tmp/src/app.ts',
        messages: [
          { ruleId: 'no-unused-vars', severity: 2, message: "'x' is assigned but never used", line: 10 },
          { ruleId: 'semi', severity: 1, message: 'Missing semicolon', line: 5 },
        ],
      },
    ])
    mockExec.mockRejectedValue({ stdout: eslintOutput, stderr: '', code: 1 })

    const result = await lintGate.run(baseCtx)
    expect(result.passed).toBe(false)
    // Only the error-severity failure should make it "not passed"
    const errors = result.failures.filter((f) => f.severity === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toBe('/tmp/src/app.ts')
    expect(errors[0].line).toBe(10)
    expect(errors[0].message).toContain('no-unused-vars')

    const warnings = result.failures.filter((f) => f.severity === 'warning')
    expect(warnings).toHaveLength(1)
  })

  it('passes when only warnings are present in eslint output', async () => {
    const eslintOutput = JSON.stringify([
      {
        filePath: '/tmp/src/app.ts',
        messages: [{ ruleId: 'semi', severity: 1, message: 'Missing semicolon', line: 5 }],
      },
    ])
    mockExec.mockRejectedValue({ stdout: eslintOutput, stderr: '', code: 1 })

    const result = await lintGate.run(baseCtx)
    expect(result.passed).toBe(true)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].severity).toBe('warning')
  })

  it('handles invalid JSON gracefully', async () => {
    mockExec.mockRejectedValue({ stdout: 'not json at all', stderr: '', code: 1 })
    const result = await lintGate.run(baseCtx)
    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(1)
  })

  it('passes when eslint fails without producing parseable lint output', async () => {
    // When stdout is empty/missing, JSON.parse('[]') succeeds with empty array
    // and there are no error-severity issues → passed=true
    mockExec.mockRejectedValue({ stderr: 'eslint: command not found', code: 127 })
    const result = await lintGate.run(baseCtx)
    expect(result.passed).toBe(true)
    expect(result.failures).toHaveLength(0)
  })
})
