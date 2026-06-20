import { describe, it, expect, vi } from 'vitest'
import type { ServerMessage, PermissionOption } from '@hip/protocol'
import { PermissionManager } from '../permission-manager.js'
import { HookRegistry } from './registry.js'
import type { ApprovalDecision } from '../tools.js'

type SendFn = (msg: ServerMessage) => void

function makePermissionMode(): 'edit' {
  return 'edit'
}
function setPermissionMode(): boolean {
  return true
}

interface DriveResult {
  decision: ApprovalDecision
  sent: ServerMessage[]
}

/** Drive the ApprovalFn returned by buildHitlApproval with an optional hook registry.
 *  Returns the resolved decision plus all sent messages. */
async function driveHitlApproval(
  hooks?: HookRegistry,
  sticky?: boolean,
  toolName?: string,
): Promise<DriveResult> {
  const send = vi.fn<SendFn>()
  const mgr = new PermissionManager(makePermissionMode, setPermissionMode, {
    enableStickyApproval: sticky ?? false,
  })
  const approvalFn = mgr.buildHitlApproval(send, 's1', 't1', () => 0, hooks)

  const resultPromise = approvalFn({ title: 'test-tool', toolName, kind: 'execute', content: 'ls' })
  const decision = await resultPromise

  return { decision, sent: send.mock.calls.map((c) => c[0]) }
}

/** Drive through buildRequestApproval in 'edit' mode with optional hooks. */
async function driveRequestApproval(
  hooks?: HookRegistry,
): Promise<DriveResult> {
  const send = vi.fn<SendFn>()
  const mgr = new PermissionManager(makePermissionMode, setPermissionMode)
  const approvalFn = mgr.buildRequestApproval(send, 's1', 't1', () => 0, 'edit', hooks)!

  const resultPromise = approvalFn({ title: 'test-tool', kind: 'execute', content: 'ls' })
  const decision = await resultPromise

  return { decision, sent: send.mock.calls.map((c) => c[0]) }
}

// ---------------------------------------------------------------------------
describe('PermissionRequest hook — auto-allow', () => {
  it('skips the prompt when hook returns allow (via buildHitlApproval)', async () => {
    const hooks = new HookRegistry()
    hooks.register({
      event: 'PermissionRequest',
      handler: async () => ({ kind: 'allow' }),
    })

    const { decision, sent } = await driveHitlApproval(hooks)

    expect(decision).toEqual({ kind: 'allow_once' })
    expect(sent).toHaveLength(0)
  })

  it('skips the prompt when hook returns allow (via buildRequestApproval)', async () => {
    const hooks = new HookRegistry()
    hooks.register({
      event: 'PermissionRequest',
      handler: async () => ({ kind: 'allow' }),
    })

    const { decision, sent } = await driveRequestApproval(hooks)

    expect(decision).toEqual({ kind: 'allow_once' })
    expect(sent).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('PermissionRequest hook — auto-deny', () => {
  it('skips the prompt when hook returns deny and resolves reject_once (via buildHitlApproval)', async () => {
    const hooks = new HookRegistry()
    hooks.register({
      event: 'PermissionRequest',
      handler: async () => ({ kind: 'deny', reason: 'blocked by policy' }),
    })

    const { decision, sent } = await driveHitlApproval(hooks)

    expect(decision).toEqual({ kind: 'reject_once' })
    expect(sent).toHaveLength(0)
  })

  it('skips the prompt when hook returns deny and resolves reject_once (via buildRequestApproval)', async () => {
    const hooks = new HookRegistry()
    hooks.register({
      event: 'PermissionRequest',
      handler: async () => ({ kind: 'deny', reason: 'blocked by policy' }),
    })

    const { decision, sent } = await driveRequestApproval(hooks)

    expect(decision).toEqual({ kind: 'reject_once' })
    expect(sent).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('PermissionRequest hook — ask (proceed with prompt)', () => {
  it('sends permission:request when hook returns ask (via buildHitlApproval)', async () => {
    const hooks = new HookRegistry()
    let hookFired = false
    hooks.register({
      event: 'PermissionRequest',
      handler: async () => {
        hookFired = true
        return { kind: 'ask' }
      },
    })

    const send = vi.fn<SendFn>()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode)
    const approvalFn = mgr.buildHitlApproval(send, 's1', 't1', () => 0, hooks)

    void approvalFn({ title: 'test-tool', kind: 'execute', content: 'ls' })
    // Wait for the async microtasks to flush
    await new Promise((r) => setTimeout(r, 10))

    expect(hookFired).toBe(true)
    expect(send.mock.calls).toHaveLength(1)
    expect(send.mock.calls[0][0].type).toBe('permission:request')
    const req = send.mock.calls[0][0] as Extract<ServerMessage, { type: 'permission:request' }>
    expect(req.tool.title).toBe('test-tool')
  })

  it('sends permission:request when no hooks are registered (via buildHitlApproval)', async () => {
    const send = vi.fn<SendFn>()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode)
    const approvalFn = mgr.buildHitlApproval(send, 's1', 't1', () => 0, undefined)

    void approvalFn({ title: 'test', kind: 'execute' })
    await new Promise((r) => setTimeout(r, 10))

    expect(send.mock.calls).toHaveLength(1)
    expect(send.mock.calls[0][0].type).toBe('permission:request')
  })

  it('sends permission:request when no hooks are registered (via buildRequestApproval)', async () => {
    const send = vi.fn<SendFn>()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode)
    const approvalFn = mgr.buildRequestApproval(send, 's1', 't1', () => 0, 'edit', undefined)!

    void approvalFn({ title: 'test', kind: 'execute' })
    await new Promise((r) => setTimeout(r, 10))

    expect(send.mock.calls).toHaveLength(1)
    expect(send.mock.calls[0][0].type).toBe('permission:request')
  })
})

// ---------------------------------------------------------------------------
describe('PermissionRequest hook — context propagation', () => {
  it('receives toolName and toolInput in hook context', async () => {
    const hooks = new HookRegistry()
    let capturedToolName: string | undefined
    let capturedToolInput: Record<string, unknown> | undefined

    hooks.register({
      event: 'PermissionRequest',
      handler: async (ctx) => {
        capturedToolName = ctx.toolName
        capturedToolInput = ctx.toolInput
        return { kind: 'allow' }
      },
    })

    await driveHitlApproval(hooks)

    expect(capturedToolName).toBe('test-tool')
    expect(capturedToolInput).toEqual({ kind: 'execute', content: 'ls' })
  })
})

// ---------------------------------------------------------------------------
describe('PermissionRequest hook — matcher matching', () => {
  it('fires when toolName matches the hook matcher and auto-allows', async () => {
    const hooks = new HookRegistry()
    let hookFired = false
    hooks.register({
      event: 'PermissionRequest',
      matcher: 'run_script',
      handler: async (ctx) => {
        hookFired = true
        expect(ctx.toolName).toBe('run_script')
        return { kind: 'allow' }
      },
    })

    const { decision, sent } = await driveHitlApproval(hooks, false, 'run_script')

    expect(hookFired).toBe(true)
    expect(decision).toEqual({ kind: 'allow_once' })
    expect(sent).toHaveLength(0)
  })

  it('falls back to HITL when toolName does not match the hook matcher', async () => {
    const hooks = new HookRegistry()
    hooks.register({
      event: 'PermissionRequest',
      matcher: 'other_tool',
      handler: async () => ({ kind: 'allow' }),
    })

    const send = vi.fn<SendFn>()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode)
    const approvalFn = mgr.buildHitlApproval(send, 's1', 't1', () => 0, hooks)

    void approvalFn({ title: 'Run script', toolName: 'run_script', kind: 'execute', content: 'ls' })
    await new Promise((r) => setTimeout(r, 10))

    expect(send.mock.calls).toHaveLength(1)
    expect(send.mock.calls[0][0].type).toBe('permission:request')
  })
})

// ---------------------------------------------------------------------------
describe('PermissionRequest hook — sticky mode', () => {
  it('auto-allow works with sticky options enabled', async () => {
    const hooks = new HookRegistry()
    hooks.register({
      event: 'PermissionRequest',
      handler: async () => ({ kind: 'allow' }),
    })

    const { decision, sent } = await driveHitlApproval(hooks, true)

    expect(decision).toEqual({ kind: 'allow_once' })
    expect(sent).toHaveLength(0)
  })

  it('normal HITL with sticky options includes allow_always/reject_always', async () => {
    const send = vi.fn<SendFn>()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode, {
      enableStickyApproval: true,
    })
    const approvalFn = mgr.buildHitlApproval(send, 's1', 't1', () => 0, undefined)

    void approvalFn({ title: 'test', kind: 'execute' })

    // Wait for the microtask
    await vi.waitFor(() => send.mock.calls.length > 0, { timeout: 100 })

    const req = send.mock.calls[0][0] as Extract<ServerMessage, { type: 'permission:request' }>
    const kinds = req.options.map((o: PermissionOption) => o.kind)
    expect(kinds).toEqual(['allow_once', 'reject_once', 'allow_always', 'reject_always'])
  })
})

// ---------------------------------------------------------------------------
describe('PermissionRequest hook — chat/full mode bypass', () => {
  it('chat mode returns undefined regardless of hooks', () => {
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode)
    const hooks = new HookRegistry()
    hooks.register({
      event: 'PermissionRequest',
      handler: async () => ({ kind: 'deny', reason: 'should not fire' }),
    })

    const approvalFn = mgr.buildRequestApproval(
      vi.fn<SendFn>(), 's1', 't1', () => 0, 'chat', hooks,
    )
    expect(approvalFn).toBeUndefined()
  })

  it('full mode auto-approves without firing hook', async () => {
    const send = vi.fn<SendFn>()
    const mgr = new PermissionManager(makePermissionMode, setPermissionMode)
    const hooks = new HookRegistry()
    let hookFired = false
    hooks.register({
      event: 'PermissionRequest',
      handler: async () => {
        hookFired = true
        return { kind: 'deny', reason: 'should not fire' }
      },
    })

    const approvalFn = mgr.buildRequestApproval(send, 's1', 't1', () => 0, 'full', hooks)!
    const decision = await approvalFn({ title: 'test', kind: 'execute' })

    expect(decision).toEqual({ kind: 'allow_once' })
    expect(hookFired).toBe(false)
    expect(send.mock.calls).toHaveLength(0)
  })
})
