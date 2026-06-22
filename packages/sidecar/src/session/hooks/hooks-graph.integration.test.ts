import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type AIMessage as AIMsg, type BaseMessage } from '@langchain/core/messages'
import { Session } from '../session.js'
import type { ModelRunner, ModelRunOptions } from '../model-runner.js'
import type { Hook, HookContext, HookResult, ServerMessage } from '@hip/protocol'

function fakeRunner(script: AIMsg[]): ModelRunner {
  let i = 0
  return {
    async run(_m: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
      const m = script[Math.min(i, script.length - 1)]; i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hip-hooks-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function makeDenyHook(event: 'PreToolUse' | 'UserPromptSubmit', reason?: string): Hook {
  return {
    event,
    handler: async () => ({ kind: 'deny', reason: reason ?? 'blocked' }),
  }
}

function capturingHook<T extends Hook['event']>(
  event: T,
  capture: { value: HookContext | null },
): Hook {
  return {
    event,
    handler: async (ctx) => {
      capture.value = ctx
      return { kind: 'allow' }
    },
  }
}

describe('hooks integration with Session graph', () => {
  // ─── PreToolUse deny blocks tool ──────────────────────────────────

  it('PreToolUse deny blocks tool execution and emits error', async () => {
    const runner = fakeRunner([
      new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'c1' }] }),
      new AIMessage('已列出目录内容。'),
    ])

    const session = new Session('s1', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, runner)

    let hookCalled = false
    session.registerHook({
      event: 'PreToolUse',
      matcher: 'ls',
      handler: async () => {
        hookCalled = true
        return { kind: 'deny', reason: 'not allowed' }
      },
    })

    const sent: ServerMessage[] = []
    await session.sendMessage('列出根目录', (m) => sent.push(m))

    expect(hookCalled).toBe(true)

    // Tool finished with error status and hook deny reason
    const toolFinished = sent.find(
      (m) => m.type === 'tool:finished' && 'callId' in m && m.status === 'error',
    ) as Extract<ServerMessage, { type: 'tool:finished' }> | undefined
    expect(toolFinished).toBeTruthy()
    expect((toolFinished as any).error).toContain('denied by hook')

    // Turn completed normally (model's second response)
    const complete = sent.find((m) => m.type === 'message:complete') as Extract<ServerMessage, { type: 'message:complete' }>
    expect(complete).toBeTruthy()
  })

  it('PreToolUse deny with matcher only blocks matching tool, other tools still run', async () => {
    const runner = fakeRunner([
      new AIMessage({ content: '', tool_calls: [{ name: 'write_file', args: { path: '/a.txt', content: 'hi' }, id: 'c1' }] }),
      new AIMessage('done'),
    ])

    const session = new Session('s2', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, runner)

    session.registerHook({
      event: 'PreToolUse',
      matcher: 'ls', // only matches ls, not write_file
      handler: async () => ({ kind: 'deny', reason: 'no ls allowed' }),
    })

    const sent: ServerMessage[] = []
    await session.sendMessage('创建文件', (m) => sent.push(m))

    // write_file should NOT be blocked (matcher is 'ls')
    const toolStarted = sent.find(
      (m) => m.type === 'tool:started' && 'name' in m && m.name === 'write_file',
    )
    expect(toolStarted).toBeTruthy()

    const toolFinished = sent.find(
      (m) => m.type === 'tool:finished' && 'callId' in m && m.status === 'finished',
    )
    expect(toolFinished).toBeTruthy()

    expect(existsSync(join(root, 'a.txt'))).toBe(true)
  })

  // ─── PostToolUse receives result ──────────────────────────────────

  it('PostToolUse receives toolOutput after successful execution', async () => {
    const runner = fakeRunner([
      new AIMessage({ content: '', tool_calls: [{ name: 'write_file', args: { path: '/hello.txt', content: 'world' }, id: 'c1' }] }),
      new AIMessage('文件已创建。'),
    ])

    const session = new Session('s3', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, runner)

    let captured: HookContext | null = null
    session.registerHook({
      event: 'PostToolUse',
      handler: async (ctx) => {
        captured = ctx
        return { kind: 'allow' }
      },
    })

    const sent: ServerMessage[] = []
    await session.sendMessage('创建 hello.txt', (m) => sent.push(m))

    expect(captured).not.toBeNull()
    expect(captured!.toolName).toBe('write_file')
    expect(captured!.toolOutput).toContain('wrote /hello.txt')
    expect(captured!.toolInput).toEqual({ path: '/hello.txt', content: 'world' })
    expect(captured!.sessionId).toBe('s3')
  })

  it('PostToolUse matcher filters by tool name', async () => {
    const runner = fakeRunner([
      new AIMessage({ content: '', tool_calls: [{ name: 'write_file', args: { path: '/x.txt', content: 'x' }, id: 'c1' }] }),
      new AIMessage('done'),
    ])

    const session = new Session('s4', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, runner)

    let writeCalled = false
    let lsCalled = false
    session.registerHook({
      event: 'PostToolUse',
      matcher: 'write_file',
      handler: async () => {
        writeCalled = true
        return { kind: 'allow' }
      },
    })
    session.registerHook({
      event: 'PostToolUse',
      matcher: 'ls',
      handler: async () => {
        lsCalled = true
        return { kind: 'allow' }
      },
    })

    await session.sendMessage('创建文件', () => {})

    expect(writeCalled).toBe(true)
    expect(lsCalled).toBe(false)
  })

  // ─── PostToolUseFailure on error ──────────────────────────────────

  it('PostToolUseFailure fires when tool schema validation fails', async () => {
    // Use a tool call with invalid args (number for path instead of string) —
    // LangChain's StructuredTool.invoke() validates with Zod, which throws.
    const runner = fakeRunner([
      new AIMessage({ content: '', tool_calls: [{ name: 'write_file', args: { path: 123, content: 'hello' }, id: 'c1' }] }),
      new AIMessage('done'),
    ])

    const session = new Session('s5', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, runner)

    let captured: HookContext | null = null
    session.registerHook({
      event: 'PostToolUseFailure',
      handler: async (ctx) => {
        captured = ctx
        return { kind: 'allow' }
      },
    })

    const sent: ServerMessage[] = []
    await session.sendMessage('写个文件', (m) => sent.push(m))

    expect(captured).not.toBeNull()
    expect(captured!.toolName).toBe('write_file')
    expect(captured!.toolError).toBeTruthy()
    expect(captured!.sessionId).toBe('s5')

    // Tool finished with error status
    const toolFinished = sent.find(
      (m) => m.type === 'tool:finished' && 'callId' in m && m.status === 'error',
    ) as Extract<ServerMessage, { type: 'tool:finished' }> | undefined
    expect(toolFinished).toBeTruthy()
  })

  it('PostToolUseFailure does NOT fire on successful tool execution', async () => {
    const runner = fakeRunner([
      new AIMessage({ content: '', tool_calls: [{ name: 'write_file', args: { path: '/ok.txt', content: 'ok' }, id: 'c1' }] }),
      new AIMessage('done'),
    ])

    const session = new Session('s6', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, runner)

    let failureCalled = false
    session.registerHook({
      event: 'PostToolUseFailure',
      handler: async () => {
        failureCalled = true
        return { kind: 'allow' }
      },
    })

    await session.sendMessage('创建文件', () => {})

    expect(failureCalled).toBe(false)
    expect(existsSync(join(root, 'ok.txt'))).toBe(true)
  })

  // ─── UserPromptSubmit deny stops turn ────────────────────────────

  it('UserPromptSubmit deny stops turn before model runs', async () => {
    // UserPromptSubmit fires before runTurn; deny should abort early.
    const session = new Session('s7', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, fakeRunner([new AIMessage('should not run')]))

    let hookCalled = false
    session.registerHook({
      event: 'UserPromptSubmit',
      handler: async (ctx) => {
        hookCalled = true
        expect(ctx.sessionId).toBe('s7')
        return { kind: 'deny', reason: 'prompt rejected by policy' }
      },
    })

    const sent: ServerMessage[] = []
    await session.sendMessage('帮我删库跑路', (m) => sent.push(m))

    expect(hookCalled).toBe(true)

    // Should emit error with HOOK_DENIED
    const errorMsg = sent.find((m) => m.type === 'error') as Extract<ServerMessage, { type: 'error' }> | undefined
    expect(errorMsg).toBeTruthy()
    expect(errorMsg!.code).toBe('HOOK_DENIED')
    expect(errorMsg!.message).toContain('prompt rejected by policy')

    // No agent should have started (turn was blocked)
    const agentStarted = sent.find((m) => m.type === 'agent:started')
    expect(agentStarted).toBeUndefined()

    // No message:complete should be emitted
    const complete = sent.find((m) => m.type === 'message:complete')
    expect(complete).toBeUndefined()
  })

  it('UserPromptSubmit allow proceeds with turn', async () => {
    const runner = fakeRunner([new AIMessage('你好，有什么可以帮你的？')])
    const session = new Session('s8', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, runner)

    let hookCalled = false
    session.registerHook({
      event: 'UserPromptSubmit',
      handler: async () => {
        hookCalled = true
        return { kind: 'allow' }
      },
    })

    const sent: ServerMessage[] = []
    await session.sendMessage('你好', (m) => sent.push(m))

    expect(hookCalled).toBe(true)

    // Turn should complete normally
    const complete = sent.find((m) => m.type === 'message:complete') as Extract<ServerMessage, { type: 'message:complete' }>
    expect(complete).toBeTruthy()
    expect(complete.message.content).toContain('你好')
  })

  it('UserPromptSubmit fail-closed: crashing handler denies turn', async () => {
    const session = new Session('s9', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, fakeRunner([new AIMessage('should not run')]))

    session.registerHook({
      event: 'UserPromptSubmit',
      handler: async () => {
        throw new Error('unexpected failure')
      },
    })

    const sent: ServerMessage[] = []
    await session.sendMessage('正常消息', (m) => sent.push(m))

    const errorMsg = sent.find((m) => m.type === 'error') as Extract<ServerMessage, { type: 'error' }> | undefined
    expect(errorMsg).toBeTruthy()
    expect(errorMsg!.code).toBe('HOOK_DENIED')

    // No turn should have run
    const agentStarted = sent.find((m) => m.type === 'agent:started')
    expect(agentStarted).toBeUndefined()
  })

  // ─── TurnStart deny stops turn and resets running flag ─────────────

  it('TurnStart deny stops turn before model runs and leaves session idle', async () => {
    const session = new Session('s11', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, fakeRunner([new AIMessage('should not run')]))

    let hookCalled = false
    session.registerHook({
      event: 'TurnStart',
      handler: async (ctx) => {
        hookCalled = true
        expect(ctx.sessionId).toBe('s11')
        return { kind: 'deny', reason: 'turn rejected by policy' }
      },
    })

    const sent: ServerMessage[] = []
    await session.sendMessage('trigger', (m) => sent.push(m))

    expect(hookCalled).toBe(true)

    const errorMsg = sent.find((m) => m.type === 'error') as Extract<ServerMessage, { type: 'error' }> | undefined
    expect(errorMsg).toBeTruthy()
    expect(errorMsg!.code).toBe('HOOK_DENIED')
    expect(errorMsg!.message).toContain('turn rejected by policy')

    const agentStarted = sent.find((m) => m.type === 'agent:started')
    expect(agentStarted).toBeUndefined()

    // Regression guard: the earlier deny must not leave running=true, otherwise
    // a later regenerate/cancel would be silently ignored.
    const sessionAny = session as unknown as { running: boolean }
    expect(sessionAny.running).toBe(false)
  })

  // ─── Multiple hooks chain ─────────────────────────────────────────

  it('multiple hooks chain: allow then deny stops correctly', async () => {
    const runner = fakeRunner([
      new AIMessage({ content: '', tool_calls: [{ name: 'write_file', args: { path: '/chain.txt', content: 'x' }, id: 'c1' }] }),
      new AIMessage('done'),
    ])

    const session = new Session('s10', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, runner)

    const calls: string[] = []
    session.registerHook({
      event: 'PreToolUse',
      handler: async () => { calls.push('audit'); return { kind: 'allow' } },
    })
    session.registerHook({
      event: 'PreToolUse',
      matcher: 'write_file',
      handler: async () => { calls.push('block-write'); return { kind: 'deny', reason: 'no writes' } },
    })
    session.registerHook({
      event: 'PreToolUse',
      handler: async () => { calls.push('SHOULD_NOT_FIRE'); return { kind: 'allow' } },
    })

    await session.sendMessage('写入文件', () => {})

    // Audit fires, blocker denies, third hook never fires (short-circuit)
    expect(calls).toEqual(['audit', 'block-write'])
    // File should NOT have been created
    expect(existsSync(join(root, 'chain.txt'))).toBe(false)
  })

  // ─── Context propagation ──────────────────────────────────────────

  it('PreToolUse receives toolName and toolInput in context', async () => {
    const runner = fakeRunner([
      new AIMessage({ content: '', tool_calls: [{ name: 'read_file', args: { path: '/nothing' }, id: 'c1' }] }),
      new AIMessage('done'),
    ])

    const session = new Session('s11', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, runner)

    let captured: HookContext | null = null
    session.registerHook({
      event: 'PreToolUse',
      matcher: 'read_file',
      handler: async (ctx) => {
        captured = ctx
        return { kind: 'allow' }
      },
    })

    await session.sendMessage('读取文件', () => {})

    expect(captured).not.toBeNull()
    expect(captured!.toolName).toBe('read_file')
    expect(captured!.toolInput).toEqual({ path: '/nothing' })
    expect(captured!.sessionId).toBe('s11')
  })
})
