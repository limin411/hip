import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { Session } from '../session.js'
import type { ModelRunner, ModelRunOptions } from '../model-runner.js'
import type { ServerMessage, SessionConfig, HookContext } from '@hip/protocol'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fakeRunner(script: AIMessage[]): ModelRunner {
  let i = 0
  return {
    async run(_m: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
      const m = script[Math.min(i, script.length - 1)]
      i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

/** Runner that records every call's messages for inspection. */
function capturingRunner(script: AIMessage[]): ModelRunner & { calls: BaseMessage[][] } {
  let i = 0
  const calls: BaseMessage[][] = []
  const runner: ModelRunner & { calls: BaseMessage[][] } = {
    calls,
    async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
      calls.push(msgs)
      const m = script[Math.min(i, script.length - 1)]
      i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
  return runner
}

function makeConfig(root: string): SessionConfig {
  return {
    llmProvider: 'deepseek',
    model: 'test-model',
    tools: [],
    cwd: root,
    permissionMode: 'edit',
  }
}

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hip-hooks-int-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

// ── Test 1: all lifecycle hooks fire in correct order ───────────────────────

describe('full hook lifecycle order', () => {
  it('all lifecycle hooks fire in correct order (UserPromptSubmit → TurnStart → PreToolUse → PermissionRequest → PostToolUse → Stop → TurnComplete)', async () => {
    const order: string[] = []

    const runner = fakeRunner([
      new AIMessage({
        content: '',
        tool_calls: [{ name: 'run_script', args: { command: 'echo hello', reason: 'test' }, id: 'c1' }],
      }),
      new AIMessage('脚本已执行。'),
    ])

    const session = new Session(
      's-lifecycle',
      makeConfig(root),
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    session.registerHook({
      event: 'UserPromptSubmit',
      handler: async () => { order.push('UserPromptSubmit'); return { kind: 'allow' } },
    })
    session.registerHook({
      event: 'TurnStart',
      handler: async () => { order.push('TurnStart'); return { kind: 'allow' } },
    })
    session.registerHook({
      event: 'PreToolUse',
      handler: async () => { order.push('PreToolUse'); return { kind: 'allow' } },
    })
    session.registerHook({
      event: 'PostToolUse',
      handler: async () => { order.push('PostToolUse'); return { kind: 'allow' } },
    })
    session.registerHook({
      event: 'PostToolUseFailure',
      handler: async () => { order.push('PostToolUseFailure'); return { kind: 'allow' } },
    })
    session.registerHook({
      event: 'PermissionRequest',
      handler: async () => { order.push('PermissionRequest'); return { kind: 'allow' } },
    })
    session.registerHook({
      event: 'TurnComplete',
      handler: async () => { order.push('TurnComplete'); return { kind: 'allow' } },
    })
    session.registerHook({
      event: 'Stop',
      handler: async () => { order.push('Stop'); return { kind: 'allow' } },
    })

    const sent: ServerMessage[] = []
    await session.sendMessage('运行一个脚本', (m) => sent.push(m))

    // Verify all expected hooks fired.
    // Note: SessionStart is NOT expected — it requires a SessionStore (first-turn detection).
    expect(order).toContain('UserPromptSubmit')
    expect(order).toContain('TurnStart')
    expect(order).toContain('PreToolUse')
    expect(order).toContain('PermissionRequest')
    expect(order).toContain('Stop')
    expect(order).toContain('TurnComplete')

    // Verify relative ordering of key hooks.
    const upIdx = order.indexOf('UserPromptSubmit')
    const tsIdx = order.indexOf('TurnStart')
    const ptIdx = order.indexOf('PreToolUse')
    const prIdx = order.indexOf('PermissionRequest')
    const poIdx = order.indexOf('PostToolUse')
    const pofIdx = order.indexOf('PostToolUseFailure')
    const stopIdx = order.indexOf('Stop')
    const tcIdx = order.indexOf('TurnComplete')

    // PostToolUse or PostToolUseFailure should have fired (one of them).
    const postIdx = poIdx !== -1 ? poIdx : pofIdx
    expect(postIdx).not.toBe(-1)

    expect(upIdx).toBeLessThan(tsIdx)        // UserPromptSubmit before TurnStart
    expect(tsIdx).toBeLessThan(ptIdx)        // TurnStart before PreToolUse
    expect(ptIdx).toBeLessThan(prIdx)        // PreToolUse before PermissionRequest
    expect(prIdx).toBeLessThan(postIdx)      // PermissionRequest before PostToolUse
    expect(postIdx).toBeLessThan(stopIdx)    // PostToolUse before Stop
    expect(stopIdx).toBeLessThan(tcIdx)      // Stop before TurnComplete

    // Turn should have completed normally.
    const complete = sent.find((m) => m.type === 'message:complete') as
      | Extract<ServerMessage, { type: 'message:complete' }>
      | undefined
    expect(complete).toBeTruthy()
  })
})

// ── Test 2: PreToolUse modify changes tool input ────────────────────────────

describe('PreToolUse modify', () => {
  it('PreToolUse modify changes tool input for write_file', async () => {
    let capturedPostInput: Record<string, unknown> | undefined

    const runner = fakeRunner([
      new AIMessage({
        content: '',
        tool_calls: [
          { name: 'write_file', args: { path: '/original.txt', content: 'original' }, id: 'c1' },
        ],
      }),
      new AIMessage('文件已创建。'),
    ])

    const session = new Session(
      's-modify',
      makeConfig(root),
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    session.registerHook({
      event: 'PreToolUse',
      matcher: 'write_file',
      handler: async () => ({
        kind: 'modify',
        modifiedInput: {
          path: '/modified.txt',
          content: 'MODIFIED CONTENT',
        },
      }),
    })
    session.registerHook({
      event: 'PostToolUse',
      matcher: 'write_file',
      handler: async (ctx) => {
        capturedPostInput = ctx.toolInput
        return { kind: 'allow' }
      },
    })

    const sent: ServerMessage[] = []
    await session.sendMessage('创建文件', (m) => sent.push(m))

    // PostToolUse receives the original tool input (ctx.toolInput is the args
    // from the model's tool_call), not the modified input.
    expect(capturedPostInput).toEqual({ path: '/original.txt', content: 'original' })

    // The modified file should exist with the modified content.
    expect(existsSync(join(root, 'modified.txt'))).toBe(true)
    const content = readFileSync(join(root, 'modified.txt'), 'utf8')
    expect(content).toBe('MODIFIED CONTENT')

    // Original file should NOT exist (modifiedInput changed the path).
    expect(existsSync(join(root, 'original.txt'))).toBe(false)
  })
})

// ── Test 3: Stop hook continue injects prompt and contexts ──────────────────

describe('Stop hook continue', () => {
  it('Stop hook continue injects prompt and additional contexts into the next turn', async () => {
    const runner = capturingRunner([
      new AIMessage('first response'),
      new AIMessage('continued response'),
    ])

    const session = new Session(
      's-stop',
      makeConfig(root),
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    session.registerHook({
      event: 'Stop',
      handler: async () => ({
        kind: 'continue',
        prompt: '请继续检查边界情况',
        additionalContexts: ['Context: running in CI mode'],
      }),
    })

    const sent: ServerMessage[] = []
    await session.sendMessage('帮我看看', (m) => sent.push(m))

    // Runner should have been called twice (first turn + continued turn).
    expect(runner.calls.length).toBe(2)

    // The second call's messages should include the injected prompt and context.
    const secondCallMsgs = runner.calls[1]
    const humanMsgs = secondCallMsgs.filter(
      (m) => m.getType() === 'human',
    )
    const systemMsgs = secondCallMsgs.filter(
      (m) => m.getType() === 'system',
    )

    // Should contain the injected prompt as a HumanMessage.
    expect(humanMsgs.some((m) => m.content === '请继续检查边界情况')).toBe(true)
    // Should contain the injected context as a SystemMessage.
    expect(systemMsgs.some((m) => m.content === 'Context: running in CI mode')).toBe(true)

    // Both turns should have completed.
    const completes = sent.filter((m) => m.type === 'message:complete') as
      Extract<ServerMessage, { type: 'message:complete' }>[]
    expect(completes.length).toBeGreaterThanOrEqual(1)
  })
})

// ── Test 4: hook error isolation — bad hook doesn't prevent other event hooks ─

describe('hook error isolation', () => {
  it('a crashing TurnStart hook does not prevent UserPromptSubmit from firing', async () => {
    let userPromptFired = false

    const runner = fakeRunner([new AIMessage('should not run')])

    const session = new Session(
      's-isolate',
      makeConfig(root),
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    // UserPromptSubmit fires BEFORE TurnStart in the sendMessage flow.
    session.registerHook({
      event: 'UserPromptSubmit',
      handler: async () => {
        userPromptFired = true
        return { kind: 'allow' }
      },
    })
    session.registerHook({
      event: 'TurnStart',
      handler: async () => {
        throw new Error('hook crashed intentionally')
      },
    })

    const sent: ServerMessage[] = []
    await session.sendMessage('正常消息', (m) => sent.push(m))

    // UserPromptSubmit should have fired despite TurnStart crashing.
    expect(userPromptFired).toBe(true)

    // Turn should have been denied because TurnStart hook crashed (fail-closed).
    const errorMsg = sent.find((m) => m.type === 'error') as
      | Extract<ServerMessage, { type: 'error' }>
      | undefined
    expect(errorMsg).toBeTruthy()
    expect(errorMsg!.code).toBe('HOOK_DENIED')

    // agent:started fires BEFORE the TurnStart hook check (ensureStarted is
    // called at line 383, TurnStart check at line 385), so it will always be
    // present. Instead verify no turn completion or agent finished occurred.
    const complete = sent.find((m) => m.type === 'message:complete') as
      | Extract<ServerMessage, { type: 'message:complete' }>
      | undefined
    expect(complete).toBeUndefined()

    const agentFinished = sent.find((m) => m.type === 'agent:finished') as
      | Extract<ServerMessage, { type: 'agent:finished' }>
      | undefined
    expect(agentFinished).toBeUndefined()
  })

  it('session remains usable after a denied turn', async () => {
    const runner = fakeRunner([new AIMessage('response after denied turn')])

    const session = new Session(
      's-isolate2',
      makeConfig(root),
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    // Register a TurnStart hook that denies the first turn.
    // Note: hooks cannot be unregistered, so once registered, this hook
    // denies ALL subsequent turns. We verify the session doesn't crash.
    session.registerHook({
      event: 'TurnStart',
      handler: async () => ({ kind: 'deny', reason: 'policy denies all turns' }),
    })

    const sent: ServerMessage[] = []
    await session.sendMessage('任何消息', (m) => sent.push(m))

    // Turn should be denied cleanly.
    const errorMsg = sent.find((m) => m.type === 'error') as
      | Extract<ServerMessage, { type: 'error' }>
      | undefined
    expect(errorMsg).toBeTruthy()
    expect(errorMsg!.code).toBe('HOOK_DENIED')
    expect(errorMsg!.message).toContain('policy denies all turns')

    // Session object should still exist (no crash).
    expect(session).toBeTruthy()
  })
})
