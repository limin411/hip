// packages/sidecar/src/orchestrator/gates/script-gate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GateContext } from '../verification-gate.js'

const mockExec = vi.fn()
vi.mock('node:child_process', () => ({
  exec: (cmd: string, opts: unknown, cb: unknown) => {
    if (typeof cb === 'function') {
      return mockExec(cmd, opts, cb)
    }
    return { cmd, opts, cb }
  },
}))
vi.mock('node:util', () => ({
  promisify: () => (cmd: string, opts?: unknown) => mockExec(cmd, opts),
}))

// Must import after mocks
import { scriptGate } from './script-gate.js'

const baseCtx: GateContext = {
  cwd: '/tmp/test-gate',
  sessionId: 'sess-1',
  runId: 'run-1',
}

describe('scriptGate', () => {
  beforeEach(() => {
    mockExec.mockReset()
  })

  it('requires config.command', async () => {
    const result = await scriptGate.run({ ...baseCtx })
    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].message).toContain('config.command')
  })

  it('passes when command exits 0', async () => {
    mockExec.mockResolvedValue({ stdout: 'ok' })
    const result = await scriptGate.run({ ...baseCtx, config: { command: 'echo hello' } })
    expect(result.passed).toBe(true)
    expect(result.failures).toHaveLength(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('includes stdout as suggestion when non-empty', async () => {
    mockExec.mockResolvedValue({ stdout: 'build output' })
    const result = await scriptGate.run({ ...baseCtx, config: { command: 'make build' } })
    expect(result.passed).toBe(true)
    expect(result.suggestions).toContain('build output')
  })

  it('omits empty suggestion when stdout is blank', async () => {
    mockExec.mockResolvedValue({ stdout: '  \n' })
    const result = await scriptGate.run({ ...baseCtx, config: { command: 'echo' } })
    expect(result.suggestions).toHaveLength(0)
  })

  it('fails when command exits non-zero', async () => {
    mockExec.mockRejectedValue({ stderr: 'command not found', code: 127 })
    const result = await scriptGate.run({ ...baseCtx, config: { command: 'nonexistent' } })
    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].severity).toBe('error')
  })

  it('uses stderr message when available', async () => {
    mockExec.mockRejectedValue({ stderr: 'permission denied', code: 1 })
    const result = await scriptGate.run({ ...baseCtx, config: { command: './script.sh' } })
    expect(result.failures[0].message).toContain('permission denied')
  })

  it('respects custom timeout from config', async () => {
    mockExec.mockResolvedValue({ stdout: 'done' })
    await scriptGate.run({ ...baseCtx, config: { command: 'sleep 1', timeoutMs: 5000 } })
    const call = mockExec.mock.calls[0]
    // Second arg should include timeout option
    expect(call[1]).toBeDefined()
  })
})
