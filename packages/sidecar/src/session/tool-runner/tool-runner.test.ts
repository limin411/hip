import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { HookRegistry } from '../hooks/registry.js'
import { SessionApprovalCache } from './approval-cache.js'
import { defaultToolPolicy } from './tool-policy.js'
import type { ToolPolicy } from './tool-policy.js'
import type { ApprovalFn, ApprovalDecision } from '../tools.js'
import { ToolRunner } from './tool-runner.js'
import type { ToolRunnerDeps } from './tool-runner.js'

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Create a mock LangChain tool that returns a known string. */
function mockTool(
  name: string,
  fn?: (args: Record<string, unknown>) => string,
): StructuredToolInterface {
  return tool(
    async (args: { message?: string }) => {
      const result = fn ? fn(args as Record<string, unknown>) : `${name}: ok`
      return result
    },
    {
      name,
      description: `Mock tool: ${name}`,
      schema: z.object({ message: z.string().optional() }),
    },
  )
}

/** Create a throwing mock tool. */
function throwingTool(name: string, errorMessage: string): StructuredToolInterface {
  return tool(
    async () => {
      throw new Error(errorMessage)
    },
    {
      name,
      description: `Throwing mock: ${name}`,
      schema: z.object({}),
    },
  )
}

/** Build a ToolRunnerDeps with sensible defaults, allowing overrides. */
function makeDeps(overrides: Partial<ToolRunnerDeps> = {}): ToolRunnerDeps {
  const tools = overrides.tools ?? new Map<string, StructuredToolInterface>()
  return {
    tools,
    toolPolicy: overrides.toolPolicy ?? defaultToolPolicy({ selfGatedTools: new Set<string>() }),
    approvalCache: overrides.approvalCache ?? new SessionApprovalCache(),
    permissionMode: overrides.permissionMode ?? 'edit',
    sessionId: overrides.sessionId ?? 'test-session',
    ...overrides,
  }
}

/** Create an ApprovalFn spy that returns the given decision. */
function approvalSpy(decision: ApprovalDecision): {
  fn: ApprovalFn
  calls: Array<Parameters<ApprovalFn>[0]>
} {
  const calls: Array<Parameters<ApprovalFn>[0]> = []
  const fn: ApprovalFn = async (req) => {
    calls.push(req)
    return decision
  }
  return { fn, calls }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ToolRunner', () => {
  // ── 1. unknown tool → error, no invoke ───────────────────────────────────
  describe('unknown tool', () => {
    it('returns error result when tool is not registered', async () => {
      const deps = makeDeps()
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'nonexistent',
        callId: 'call-1',
        args: {},
      })

      expect(result.content).toBe('Error: unknown tool: nonexistent')
      expect(result.tool_call_id).toBe('call-1')
      expect(result.name).toBe('nonexistent')
    })

    it('emits error lifecycle events', async () => {
      const onToolStarted = vi.fn()
      const onToolFinished = vi.fn()
      const deps = makeDeps({ onToolStarted, onToolFinished })
      const runner = new ToolRunner(deps)

      await runner.runToolCall({ name: 'nope', callId: 'c1', args: {} })

      expect(onToolStarted).toHaveBeenCalledWith('nope', 'c1', undefined)
      expect(onToolFinished).toHaveBeenCalledWith('c1', 'error', undefined, 'unknown tool: nope')
    })

    it('aliases bash/shell/sh to run_script when registered', async () => {
      const t = mockTool('run_script', async () => 'ok-from-script')
      const deps = makeDeps({ tools: new Map([['run_script', t]]) })
      const runner = new ToolRunner(deps)
      for (const name of ['bash', 'shell', 'sh'] as const) {
        const result = await runner.runToolCall({ name, callId: `c-${name}`, args: { command: 'echo hi' } })
        expect(result.content).toBe('ok-from-script')
      }
    })

    it('blocks read_file/ls under .git/objects', async () => {
      let invoked = false
      const t = mockTool('read_file', () => {
        invoked = true
        return 'blob'
      })
      const deps = makeDeps({ tools: new Map([['read_file', t]]) })
      const runner = new ToolRunner(deps)
      const result = await runner.runToolCall({
        name: 'read_file',
        callId: 'c-git',
        args: { path: '/proj/.git/objects/ab/cdef' },
      })
      expect(result.content).toMatch(/refusing read_file on git object path/)
      expect(invoked).toBe(false)
    })
  })

  describe('activity pulse during long tools', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('calls onActivity at start and on interval while tool runs', async () => {
      let resolveTool!: () => void
      const gate = new Promise<void>((r) => { resolveTool = r })
      const slow = tool(
        async () => {
          await gate
          return 'done'
        },
        { name: 'slow', description: 'slow', schema: z.object({}) },
      )
      const onActivity = vi.fn()
      const deps = makeDeps({
        tools: new Map([['slow', slow]]),
        onActivity,
        activityIntervalMs: 50,
      })
      const runner = new ToolRunner(deps)
      const pending = runner.runToolCall({ name: 'slow', callId: 'c-slow', args: {} })
      expect(onActivity.mock.calls.length).toBeGreaterThanOrEqual(1)
      await vi.advanceTimersByTimeAsync(120)
      expect(onActivity.mock.calls.length).toBeGreaterThanOrEqual(3)
      resolveTool()
      await pending
      const after = onActivity.mock.calls.length
      await vi.advanceTimersByTimeAsync(200)
      expect(onActivity.mock.calls.length).toBe(after)
    })
  })

  // ── 2. PreToolUse deny → error, no invoke ────────────────────────────────
  describe('PreToolUse deny', () => {
    it('returns error result without invoking tool', async () => {
      const t = mockTool('read_file')
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PreToolUse',
        handler: async () => ({ kind: 'deny', reason: 'not allowed' }),
      })
      const deps = makeDeps({
        tools: new Map([['read_file', t]]),
        hooks,
      })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'read_file',
        callId: 'call-2',
        args: { message: 'test' },
      })

      expect(result.content).toContain('denied by hook')
      expect(result.content).toContain('not allowed')
    })

    it('emits error lifecycle events on deny', async () => {
      const t = mockTool('read_file')
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PreToolUse',
        handler: async () => ({ kind: 'deny' }),
      })
      const onToolStarted = vi.fn()
      const onToolFinished = vi.fn()
      const deps = makeDeps({
        tools: new Map([['read_file', t]]),
        hooks,
        onToolStarted,
        onToolFinished,
      })
      const runner = new ToolRunner(deps)

      await runner.runToolCall({ name: 'read_file', callId: 'c2', args: {} })

      expect(onToolStarted).toHaveBeenCalledWith('read_file', 'c2', undefined)
      expect(onToolFinished).toHaveBeenCalledWith('c2', 'error', undefined, 'tool execution denied by hook')
    })
  })

  // ── 3. PreToolUse ask + allow → invokes ──────────────────────────────────
  describe('PreToolUse ask with allow', () => {
    it('invokes tool after user approves', async () => {
      const t = mockTool('write_file')
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PreToolUse',
        handler: async () => ({ kind: 'ask', reason: 'confirm write' }),
      })
      const { fn, calls } = approvalSpy({ kind: 'allow_once' })
      const deps = makeDeps({
        tools: new Map([['write_file', t]]),
        hooks,
        requestApproval: fn,
      })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'write_file',
        callId: 'call-3',
        args: { message: 'hello' },
      })

      expect(result.content).toBe('write_file: ok')
      expect(calls.length).toBe(1)
      expect(calls[0].title).toContain('write_file')
    })

    it('caches allow_always decision and skips prompt next time', async () => {
      const t = mockTool('write_file')
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PreToolUse',
        handler: async () => ({ kind: 'ask' }),
      })
      const { fn, calls } = approvalSpy({ kind: 'allow_always' })
      const cache = new SessionApprovalCache()
      const deps = makeDeps({
        tools: new Map([['write_file', t]]),
        hooks,
        requestApproval: fn,
        approvalCache: cache,
      })
      const runner = new ToolRunner(deps)

      // First call: prompts, caches allow_always for these args
      const r1 = await runner.runToolCall({ name: 'write_file', callId: 'c3a', args: { message: 'x' } })
      expect(r1.content).toBe('write_file: ok')
      expect(calls.length).toBe(1)

      // Second call with same args: cache hit, no prompt
      const r2 = await runner.runToolCall({ name: 'write_file', callId: 'c3b', args: { message: 'x' } })
      expect(r2.content).toBe('write_file: ok')
      expect(calls.length).toBe(1) // still 1
    })
  })

  // ── 4. PreToolUse ask + reject → error ───────────────────────────────────
  describe('PreToolUse ask with reject', () => {
    it('returns error when user rejects', async () => {
      const t = mockTool('write_file')
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PreToolUse',
        handler: async () => ({ kind: 'ask' }),
      })
      const { fn, calls } = approvalSpy({ kind: 'reject_once' })
      const deps = makeDeps({
        tools: new Map([['write_file', t]]),
        hooks,
        requestApproval: fn,
      })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'write_file',
        callId: 'call-4',
        args: {},
      })

      expect(result.content).toContain('rejected by user')
      expect(calls.length).toBe(1)
    })

    it('caches reject_always and skips prompt next time', async () => {
      const t = mockTool('write_file')
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PreToolUse',
        handler: async () => ({ kind: 'ask' }),
      })
      const { fn, calls } = approvalSpy({ kind: 'reject_always' })
      const cache = new SessionApprovalCache()
      const deps = makeDeps({
        tools: new Map([['write_file', t]]),
        hooks,
        requestApproval: fn,
        approvalCache: cache,
      })
      const runner = new ToolRunner(deps)

      // First call: prompts
      const r1 = await runner.runToolCall({ name: 'write_file', callId: 'c4a', args: {} })
      expect(r1.content).toContain('rejected')
      expect(calls.length).toBe(1)

      // Second call: cache hit → reject without prompt
      const r2 = await runner.runToolCall({ name: 'write_file', callId: 'c4b', args: {} })
      expect(r2.content).toContain('rejected (cached)')
      expect(calls.length).toBe(1) // still 1
    })
  })

  // ── 5. PreToolUse ask without requestApproval → deny (F1) ─────────────────
  describe('PreToolUse ask without requestApproval', () => {
    it('denies with F1 message when no approval transport is available', async () => {
      const t = mockTool('write_file')
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PreToolUse',
        handler: async () => ({ kind: 'ask', reason: 'needs approval' }),
      })
      const deps = makeDeps({
        tools: new Map([['write_file', t]]),
        hooks,
        requestApproval: undefined,
      })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'write_file',
        callId: 'call-5',
        args: {},
      })

      expect(result.content).toBe('Error: approval required but no approval transport available')
    })
  })

  // ── 6. updatedInput replaces args ────────────────────────────────────────
  describe('updatedInput', () => {
    it('replaces invokeArgs when hook returns ask with updatedInput', async () => {
      let invokedArgs: Record<string, unknown> | undefined
      const t = mockTool('edit_file', (args) => {
        invokedArgs = args
        return 'edit_file: ok'
      })
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PreToolUse',
        handler: async () => ({
          kind: 'ask',
          updatedInput: { message: 'modified by hook' },
        }),
      })
      const { fn } = approvalSpy({ kind: 'allow_once' })
      const deps = makeDeps({
        tools: new Map([['edit_file', t]]),
        hooks,
        requestApproval: fn,
      })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'edit_file',
        callId: 'call-6',
        args: { message: 'original' },
      })

      expect(result.content).toBe('edit_file: ok')
      expect(invokedArgs).toEqual({ message: 'modified by hook' })
    })

    it('applies updatedInput from ask hook when approved', async () => {
      let invokedArgs: Record<string, unknown> | undefined
      const t = mockTool('edit_file', (args) => {
        invokedArgs = args
        return 'edit_file: ok'
      })
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PreToolUse',
        handler: async () => ({
          kind: 'ask',
          updatedInput: { message: 'approved and modified' },
        }),
      })
      const { fn } = approvalSpy({ kind: 'allow_once' })
      const deps = makeDeps({
        tools: new Map([['edit_file', t]]),
        hooks,
        requestApproval: fn,
      })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'edit_file',
        callId: 'call-6b',
        args: { message: 'original' },
      })

      expect(result.content).toBe('edit_file: ok')
      expect(invokedArgs).toEqual({ message: 'approved and modified' })
    })
  })

  // ── 7. PostToolUse rewrites output ───────────────────────────────────────
  describe('PostToolUse output rewrite', () => {
    it('rewrites output when PostToolUse hook returns ask with updatedInput', async () => {
      const t = mockTool('ls')
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PostToolUse',
        handler: async (ctx) => ({
          kind: 'ask',
          updatedInput: { output: `rewritten: [${ctx.toolOutput}]` },
        }),
      })
      const deps = makeDeps({
        tools: new Map([['ls', t]]),
        hooks,
      })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'ls',
        callId: 'call-7',
        args: {},
      })

      expect(result.content).toBe('rewritten: [ls: ok]')
    })

    it('falls back to whole updatedInput as string when output key is absent', async () => {
      const t = mockTool('ls')
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PostToolUse',
        handler: async () => ({
          kind: 'ask',
          updatedInput: { output: 'plain string fallback' },
        }),
      })
      const deps = makeDeps({
        tools: new Map([['ls', t]]),
        hooks,
      })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'ls',
        callId: 'call-7b',
        args: {},
      })

      expect(result.content).toBe('plain string fallback')
    })
  })

  // ── 8. throw → PostToolUseFailure + error result ─────────────────────────
  describe('tool invocation throws', () => {
    it('returns error result and fires PostToolUseFailure', async () => {
      const t = throwingTool('broken_tool', 'something went wrong')
      const failureCalls: Array<{ toolName?: string; toolError?: string }> = []
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PostToolUseFailure',
        handler: async (ctx) => {
          failureCalls.push({ toolName: ctx.toolName, toolError: ctx.toolError })
          return { kind: 'allow' }
        },
      })
      const deps = makeDeps({
        tools: new Map([['broken_tool', t]]),
        hooks,
      })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'broken_tool',
        callId: 'call-8',
        args: {},
      })

      expect(result.content).toBe('Error: something went wrong')
      expect(failureCalls).toHaveLength(1)
      expect(failureCalls[0].toolName).toBe('broken_tool')
      expect(failureCalls[0].toolError).toBe('something went wrong')
    })

    it('emits error lifecycle on throw', async () => {
      const t = throwingTool('boom', 'kaboom')
      const onToolStarted = vi.fn()
      const onToolFinished = vi.fn()
      const deps = makeDeps({
        tools: new Map([['boom', t]]),
        onToolStarted,
        onToolFinished,
      })
      const runner = new ToolRunner(deps)

      await runner.runToolCall({ name: 'boom', callId: 'c8', args: {} })

      expect(onToolStarted).toHaveBeenCalledWith('boom', 'c8', {})
      expect(onToolFinished).toHaveBeenCalledWith('c8', 'error', undefined, 'kaboom')
    })
  })

  // ── 9. cache hit skips requestApproval ───────────────────────────────────
  describe('cache hit skips requestApproval', () => {
    it('uses cached allow without prompting', async () => {
      const t = mockTool('write_file')
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PreToolUse',
        handler: async () => ({ kind: 'ask' }),
      })
      const cache = new SessionApprovalCache()
      // Pre-seed allow
      cache.set('write_file', { message: 'a' }, { kind: 'allow_always' })

      const { fn, calls } = approvalSpy({ kind: 'allow_once' })
      const deps = makeDeps({
        tools: new Map([['write_file', t]]),
        hooks,
        requestApproval: fn,
        approvalCache: cache,
      })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'write_file',
        callId: 'call-9',
        args: { message: 'a' },
      })

      expect(result.content).toBe('write_file: ok')
      expect(calls.length).toBe(0) // no prompt
    })

    it('uses cached reject without prompting', async () => {
      const t = mockTool('write_file')
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PreToolUse',
        handler: async () => ({ kind: 'ask' }),
      })
      const cache = new SessionApprovalCache()
      cache.set('write_file', undefined, { kind: 'reject_always' })

      const { fn, calls } = approvalSpy({ kind: 'allow_once' })
      const deps = makeDeps({
        tools: new Map([['write_file', t]]),
        hooks,
        requestApproval: fn,
        approvalCache: cache,
      })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'write_file',
        callId: 'call-9b',
        args: {},
      })

      expect(result.content).toContain('rejected (cached)')
      expect(calls.length).toBe(0)
    })
  })

  // ── 10. self-gated tool bypasses runner approval ─────────────────────────
  describe('self-gated tool bypasses runner approval', () => {
    it('does not prompt when hook returns ask for a self-gated tool', async () => {
      const t = mockTool('run_script')
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PreToolUse',
        handler: async () => ({ kind: 'ask', reason: 'needs check' }),
      })
      const { fn, calls } = approvalSpy({ kind: 'allow_once' })
      const selfGated = new Set(['run_script'])
      const deps = makeDeps({
        tools: new Map([['run_script', t]]),
        hooks,
        requestApproval: fn,
        toolPolicy: defaultToolPolicy({ selfGatedTools: selfGated }),
      })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'run_script',
        callId: 'call-10',
        args: { message: 'ls' },
      })

      // Tool is invoked directly — runner does not prompt
      expect(result.content).toBe('run_script: ok')
      expect(calls.length).toBe(0)
    })

    it('auto-allow in full mode also skips prompt', async () => {
      const t = mockTool('run_script')
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PreToolUse',
        handler: async () => ({ kind: 'ask' }),
      })
      const { fn, calls } = approvalSpy({ kind: 'allow_once' })
      const selfGated = new Set(['run_script'])
      const deps = makeDeps({
        tools: new Map([['run_script', t]]),
        hooks,
        requestApproval: fn,
        permissionMode: 'full',
        toolPolicy: defaultToolPolicy({ selfGatedTools: selfGated }),
      })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'run_script',
        callId: 'call-10b',
        args: {},
      })

      expect(result.content).toBe('run_script: ok')
      expect(calls.length).toBe(0)
    })
  })

  // ── 11. result feeds exactly one ToolMessage-equivalent output ────────────
  describe('ToolMessage-equivalent output', () => {
    it('success result has content, tool_call_id, and name', async () => {
      const t = mockTool('read_file')
      const deps = makeDeps({ tools: new Map([['read_file', t]]) })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'read_file',
        callId: 'success-call',
        args: {},
      })

      expect(result).toEqual({
        content: 'read_file: ok',
        tool_call_id: 'success-call',
        name: 'read_file',
      })
    })

    it('error result has content, tool_call_id, and name', async () => {
      const deps = makeDeps()
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'ghost',
        callId: 'error-call',
        args: {},
      })

      expect(result).toEqual({
        content: 'Error: unknown tool: ghost',
        tool_call_id: 'error-call',
        name: 'ghost',
      })
    })
  })

  // ── Edge cases ────────────────────────────────────────────────────────────
  describe('PostToolUseFailure is not called without hooks', () => {
    it('throws silently for error without hook registry', async () => {
      const t = throwingTool('boom', 'crash')
      const deps = makeDeps({ tools: new Map([['boom', t]]) })
      const runner = new ToolRunner(deps)

      // Should not throw — error is captured in result
      const result = await runner.runToolCall({
        name: 'boom',
        callId: 'c-edge',
        args: {},
      })

      expect(result.content).toBe('Error: crash')
    })
  })

  describe('allow hook with no overrides invokes normally', () => {
    it('returns tool output unchanged', async () => {
      const t = mockTool('ls')
      const hooks = new HookRegistry()
      hooks.register({
        event: 'PreToolUse',
        handler: async () => ({ kind: 'allow' }),
      })
      const deps = makeDeps({
        tools: new Map([['ls', t]]),
        hooks,
      })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'ls',
        callId: 'c-norm',
        args: {},
      })

      expect(result.content).toBe('ls: ok')
    })
  })

  describe('no hooks at all', () => {
    it('invokes tool directly with no hooks registered', async () => {
      const t = mockTool('read_file')
      const deps = makeDeps({ tools: new Map([['read_file', t]]) })
      const runner = new ToolRunner(deps)

      const result = await runner.runToolCall({
        name: 'read_file',
        callId: 'c-nohook',
        args: {},
      })

      expect(result.content).toBe('read_file: ok')
    })
  })
})
