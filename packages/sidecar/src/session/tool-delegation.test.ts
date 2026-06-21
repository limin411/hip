import { describe, it, expect, vi } from 'vitest'
import { ToolDelegate } from './tool-delegation.js'
import { ToolRunner } from './tool-runner/tool-runner.js'
import type { ToolCallResult } from './tool-runner/tool-runner.js'
import { SessionApprovalCache } from './tool-runner/approval-cache.js'
import { defaultToolPolicy } from './tool-runner/tool-policy.js'

/** Build a ToolRunner whose runToolCall method is replaced by a mock. */
function makeRunner(result: ToolCallResult): ToolRunner {
  const runner = new ToolRunner({
    tools: new Map(),
    toolPolicy: defaultToolPolicy({ selfGatedTools: new Set() }),
    approvalCache: new SessionApprovalCache(),
    permissionMode: 'edit',
    sessionId: 'test-session',
  })
  runner.runToolCall = vi.fn().mockResolvedValue(result)
  return runner
}

describe('ToolDelegate', () => {
  // 1. delegate enabled → ACP tool call routes through ToolRunner
  it('routes ACP tool call through ToolRunner when enabled and ready', async () => {
    const runner = makeRunner({
      content: 'file written',
      tool_call_id: 'c1',
      name: 'write_file',
    })
    const delegate = new ToolDelegate({ enabled: true }, runner)
    delegate.markReady('agent-1')

    await delegate.invokeTool('agent-1', {
      name: 'write_file',
      input: { path: 'x', content: 'y' },
    })

    expect(runner.runToolCall).toHaveBeenCalledWith({
      name: 'write_file',
      callId: expect.stringMatching(/^delegate:agent-1:write_file:\d+$/),
      args: { path: 'x', content: 'y' },
    })
  })

  // 2. result returned correctly via invokeTool
  it('returns ToolRunner output via invokeTool', async () => {
    const runner = makeRunner({
      content: 'file written',
      tool_call_id: 'c1',
      name: 'write_file',
    })
    const delegate = new ToolDelegate({ enabled: true }, runner)
    delegate.markReady('agent-1')

    const result = await delegate.invokeTool('agent-1', {
      name: 'write_file',
      input: { path: 'x', content: 'y' },
    })

    expect(result.output).toBe('file written')
    expect(result.error).toBeUndefined()
  })

  // 3. anti-recursion: dispatch_agent rejected
  it('rejects dispatch_agent for anti-recursion', async () => {
    const runner = makeRunner({
      content: 'ok',
      tool_call_id: 'c1',
      name: 'dispatch_agent',
    })
    const delegate = new ToolDelegate({ enabled: true }, runner)
    delegate.markReady('agent-1')

    const result = await delegate.invokeTool('agent-1', {
      name: 'dispatch_agent',
      input: {},
    })

    expect(result.error).toBe('tool "dispatch_agent" cannot be delegated')
    expect(result.output).toBe('')
    expect(runner.runToolCall).not.toHaveBeenCalled()
  })

  // 4. anti-recursion: task rejected
  it('rejects task for anti-recursion', async () => {
    const runner = makeRunner({
      content: 'ok',
      tool_call_id: 'c1',
      name: 'task',
    })
    const delegate = new ToolDelegate({ enabled: true }, runner)
    delegate.markReady('agent-1')

    const result = await delegate.invokeTool('agent-1', {
      name: 'task',
      input: {},
    })

    expect(result.error).toBe('tool "task" cannot be delegated')
    expect(result.output).toBe('')
    expect(runner.runToolCall).not.toHaveBeenCalled()
  })

  // 5. delegate disabled → invokeTool returns error "delegation not enabled"
  it('returns error when delegation is disabled', async () => {
    const runner = makeRunner({
      content: 'ok',
      tool_call_id: 'c1',
      name: 'read_file',
    })
    const delegate = new ToolDelegate({ enabled: false }, runner)
    delegate.markReady('agent-1')

    const result = await delegate.invokeTool('agent-1', {
      name: 'read_file',
      input: {},
    })

    expect(result.error).toBe('delegation not enabled')
    expect(result.output).toBe('')
    expect(runner.runToolCall).not.toHaveBeenCalled()
  })

  // 6. gate: markReady → isReady=true; markUnready → isReady=false
  it('manages ready state via markReady, markUnready, and isReady', () => {
    const delegate = new ToolDelegate(
      { enabled: true },
      makeRunner({ content: '', tool_call_id: 'c1', name: 'x' }),
    )

    expect(delegate.isReady('agent-1')).toBe(false)

    delegate.markReady('agent-1')
    expect(delegate.isReady('agent-1')).toBe(true)

    delegate.markUnready('agent-1')
    expect(delegate.isReady('agent-1')).toBe(false)
  })

  // 7. not-ready agent → invokeTool returns error "agent not ready"
  it('returns error when agent is not ready', async () => {
    const runner = makeRunner({
      content: 'ok',
      tool_call_id: 'c1',
      name: 'read_file',
    })
    const delegate = new ToolDelegate({ enabled: true }, runner)

    const result = await delegate.invokeTool('agent-1', {
      name: 'read_file',
      input: {},
    })

    expect(result.error).toBe('agent not ready')
    expect(result.output).toBe('')
    expect(runner.runToolCall).not.toHaveBeenCalled()
  })

  // 8. ToolRunner error content is propagated as invokeTool error.
  it('propagates ToolRunner error content as invokeTool error', async () => {
    const runner = makeRunner({
      content: 'Error: permission denied',
      tool_call_id: 'c1',
      name: 'read_file',
    })
    const delegate = new ToolDelegate({ enabled: true }, runner)
    delegate.markReady('agent-1')

    const result = await delegate.invokeTool('agent-1', {
      name: 'read_file',
      input: {},
    })

    expect(result.error).toBe('permission denied')
    expect(result.output).toBe('')
  })

  // 9. allowedTools restricts delegated tools.
  it('rejects tools outside the allowedTools whitelist', async () => {
    const runner = makeRunner({
      content: 'ok',
      tool_call_id: 'c1',
      name: 'edit_file',
    })
    const delegate = new ToolDelegate(
      { enabled: true, allowedTools: ['read_file'] },
      runner,
    )
    delegate.markReady('agent-1')

    const result = await delegate.invokeTool('agent-1', {
      name: 'edit_file',
      input: {},
    })

    expect(result.error).toBe('tool "edit_file" is not allowed for delegation')
    expect(result.output).toBe('')
    expect(runner.runToolCall).not.toHaveBeenCalled()
  })
})
