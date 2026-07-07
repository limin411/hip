// packages/sidecar/src/orchestrator/gates/test-gate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GateContext } from '../verification-gate.js'

const mockExec = vi.fn()
vi.mock('node:child_process', () => ({
  exec: () => {},
}))
vi.mock('node:util', () => ({
  promisify: () => (cmd: string, opts?: unknown) => mockExec(cmd, opts),
}))

import { testGate } from './test-gate.js'

const baseCtx: GateContext = {
  cwd: '/tmp/test-gate-test',
  sessionId: 'sess-1',
  runId: 'run-1',
}

describe('testGate', () => {
  beforeEach(() => {
    mockExec.mockReset()
  })

  it('passes when vitest exits 0', async () => {
    mockExec.mockResolvedValue({})
    const result = await testGate.run(baseCtx)
    expect(result.passed).toBe(true)
    expect(result.failures).toHaveLength(0)
  })

  it('parses FAIL and ERROR lines from vitest output', async () => {
    const output = [
      'FAIL  src/foo.test.ts\n',
      'AssertionError: expected 1 to be 2\n',
      'FAIL  src/bar.test.ts\n',
    ].join('')
    mockExec.mockRejectedValue({ stdout: output, stderr: '', code: 1 })

    const result = await testGate.run(baseCtx)
    expect(result.passed).toBe(false)
    expect(result.failures.length).toBeGreaterThanOrEqual(1)
    expect(result.failures[0].message).toContain('FAIL')
    expect(result.failures[0].message).toContain('src/foo.test.ts')
  })

  it('parses ERROR lines from vitest output', async () => {
    const output = [
      'ERROR  src/baz.test.ts > baz > timeout',
      'Error: Test timed out in 5000ms',
    ].join('\n')
    mockExec.mockRejectedValue({ stdout: output, stderr: '', code: 1 })

    const result = await testGate.run(baseCtx)
    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].message).toContain('ERROR')
    expect(result.failures[0].message).toContain('baz.test.ts')
  })

  it('includes fallback message when output cannot be parsed', async () => {
    mockExec.mockRejectedValue({ stdout: '', stderr: '', code: 1 })
    const result = await testGate.run(baseCtx)
    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].message).toContain('parse error')
  })

  it('suggests fixing tests and re-running', async () => {
    mockExec.mockRejectedValue({ stdout: 'FAIL  src/x.test.ts', stderr: '', code: 1 })
    const result = await testGate.run(baseCtx)
    expect(result.suggestions).toContain('Fix failing tests and re-run')
  })

  it('allows custom command via config', async () => {
    mockExec.mockResolvedValue({})
    await testGate.run({ ...baseCtx, config: { command: 'npx jest' } })
    expect(mockExec).toHaveBeenCalledWith('npx jest', expect.objectContaining({ cwd: baseCtx.cwd }))
  })
})
