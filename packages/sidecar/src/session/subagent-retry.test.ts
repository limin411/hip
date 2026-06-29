import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import type { ServerMessage } from '@hip/protocol'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { GraphEmit } from './graph.js'
import { Session } from './session.js'
import { buildSubagentTools } from './tools/subagent.js'
import { buildAllTools } from './tools/index.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hip-retry-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function fakeRunner(...responses: string[]): ModelRunner {
  let i = 0
  return {
    async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
      opts.signal?.throwIfAborted?.()
      const text = responses[Math.min(i, responses.length - 1)]
      i++
      if (text) opts.onText(text)
      return new AIMessage(text)
    },
  }
}

/** A ModelRunner that captures the messages array for assertion. */
class CapturingRunner implements ModelRunner {
  captured: BaseMessage[] = []
  constructor(private readonly response: string = 'done') {}
  async run(messages: BaseMessage[], _opts: ModelRunOptions): Promise<AIMessage> {
    this.captured = messages
    return new AIMessage(this.response)
  }
}

// ── buildSubagentTools: task_retry tool appearance ──────────────────────────

describe('buildSubagentTools — task_retry', () => {
  const spawn = async () => 'ok'

  it('does NOT include task_retry when retrySubagent is not provided', () => {
    const { subagentTools } = buildSubagentTools(spawn)
    const names = subagentTools.map((t) => t.name)
    expect(names).not.toContain('task_retry')
    expect(names).toContain('task')
  })

  it('includes task_retry when retrySubagent is provided', () => {
    const retry = async () => 'retried'
    const { subagentTools } = buildSubagentTools(spawn, undefined, retry)
    const names = subagentTools.map((t) => t.name)
    expect(names).toContain('task')
    expect(names).toContain('task_retry')
  })

  it('task_retry tool has the expected schema', () => {
    const retry = async () => 'retried'
    const { subagentTools } = buildSubagentTools(spawn, undefined, retry)
    const retryTool = subagentTools.find((t) => t.name === 'task_retry')
    expect(retryTool).toBeDefined()
    expect(retryTool!.description).toMatch(/retry/i)
    expect(retryTool!.description).toMatch(/agentId/i)
  })

  it('task_retry calls the retrySubagent callback', async () => {
    let calledWith = ''
    const retry = async (agentId: string) => { calledWith = agentId; return 'retry result' }
    const { subagentTools } = buildSubagentTools(spawn, undefined, retry)
    const retryTool = subagentTools.find((t) => t.name === 'task_retry')!
    const result = await retryTool.invoke({ agent_id: 'worker-1' })
    expect(calledWith).toBe('worker-1')
    expect(result).toBe('retry result')
  })

  it('task_retry appears in buildAllTools when retrySubagent is passed', () => {
    const retry = async () => 'retried'
    const tools = buildAllTools(root, spawn, undefined, undefined, {}, retry)
    const names = tools.map((t) => t.name)
    expect(names).toContain('task')
    expect(names).toContain('task_retry')
  })

  it('task_retry does NOT appear in buildAllTools when no retrySubagent', () => {
    const tools = buildAllTools(root, spawn)
    const names = tools.map((t) => t.name)
    expect(names).toContain('task')
    expect(names).not.toContain('task_retry')
  })
})

// ── Session.retrySubagent() ─────────────────────────────────────────────────

describe('Session.retrySubagent()', () => {
  const mkSession = (runner: ModelRunner) =>
    new Session('s1', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as never, undefined, undefined, undefined, 60_000, runner)

  const fakeSend = vi.fn() as (m: ServerMessage) => void

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an error string when agentId is not tracked', async () => {
    const session = mkSession(fakeRunner('ok'))
    const result = await session.retrySubagent('nonexistent', fakeSend)
    expect(result).toContain('Error:')
    expect(result).toContain('not found')
  })

  it('retries a known subagent and returns the result', async () => {
    const session = mkSession(fakeRunner('retry succeeded'))
    // Simulate a previously spawned subagent
    ;(session as unknown as { spawnedSubagentIds: Set<string> }).spawnedSubagentIds.add('worker-1')
    ;(session as unknown as { subagentInstances: Map<string, { description: string }> }).subagentInstances.set('worker-1', { description: 'original task' })

    const result = await session.retrySubagent('worker-1', fakeSend)

    expect(result).toBe('retry succeeded')
    // Verify agent:started and agent:finished were sent
    expect(fakeSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent:started', agentId: 'worker-1' }))
    expect(fakeSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent:finished', agentId: 'worker-1' }))
  })

  it('preserves prior message history when retrying with stored messages', async () => {
    const runner = new CapturingRunner('second attempt ok')
    const session = mkSession(runner)
    ;(session as unknown as { spawnedSubagentIds: Set<string> }).spawnedSubagentIds.add('worker-2')
    ;(session as unknown as { subagentInstances: Map<string, { description: string }> }).subagentInstances.set('worker-2', { description: 'investigate bug' })

    const storedMessages = [
      { role: 'user' as const, content: 'previous request' },
      { role: 'assistant' as const, content: 'previous response' },
      { role: 'user' as const, content: 'investigate bug' },
      { role: 'assistant' as const, content: 'Error: something broke' },
    ]
    const mockStore = {
      getMessages: vi.fn((_taskId: string) => storedMessages),
    }
    ;(session as unknown as { store: { getMessages: (id: string) => { role: string; content: string }[] } }).store = mockStore as never

    await session.retrySubagent('worker-2', fakeSend)

    // The runner should see prior context (messages before the last user message)
    // = [HumanMessage('previous request'), AIMessage('previous response')]
    expect(runner.captured.length).toBeGreaterThanOrEqual(2)
    const hasHuman = runner.captured.some((m) => m instanceof HumanMessage && (m as HumanMessage).content === 'previous request')
    expect(hasHuman).toBe(true)
    // The retry description should be the last user message content
    expect(mockStore.getMessages).toHaveBeenCalledWith('worker-2')
  })

  it('uses the last user message as the retry description', async () => {
    const runner = new CapturingRunner('retried ok')
    const session = mkSession(runner)
    ;(session as unknown as { spawnedSubagentIds: Set<string> }).spawnedSubagentIds.add('worker-3')
    ;(session as unknown as { subagentInstances: Map<string, { description: string }> }).subagentInstances.set('worker-3', { description: 'stale description' })

    const storedMessages = [
      { role: 'user' as const, content: 'first task' },
      { role: 'assistant' as const, content: 'first result' },
      { role: 'user' as const, content: 'second task' },
      { role: 'assistant' as const, content: 'second result failed' },
    ]
    ;(session as unknown as { store: { getMessages: (id: string) => { role: string; content: string }[] } }).store = {
      getMessages: () => storedMessages,
    } as never

    await session.retrySubagent('worker-3', fakeSend)

    // The last human message in storedMessages is 'second task' — that should be the retry prompt
    const lastHumanInCaptured = runner.captured.filter((m) => m instanceof HumanMessage).at(-1) as HumanMessage | undefined
    expect(lastHumanInCaptured).toBeDefined()
    expect(lastHumanInCaptured!.content).toBe('second task')
  })

  it('handles subagent errors gracefully and returns an error string', async () => {
    const session = mkSession(fakeRunner('partial work'))
    ;(session as unknown as { spawnedSubagentIds: Set<string> }).spawnedSubagentIds.add('worker-err')
    ;(session as unknown as { subagentInstances: Map<string, { description: string }> }).subagentInstances.set('worker-err', { description: 'risky task' })
    // Override runSubagent to throw — we test via the real flow but with a throwing runner
    const runner: ModelRunner = {
      async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        throw new Error('model crashed')
      },
    }
    const s = mkSession(runner)
    ;(s as unknown as { spawnedSubagentIds: Set<string> }).spawnedSubagentIds.add('worker-err')
    ;(s as unknown as { subagentInstances: Map<string, { description: string }> }).subagentInstances.set('worker-err', { description: 'risky task' })

    const result = await s.retrySubagent('worker-err', fakeSend)
    expect(result).toContain('Error:')
    expect(result).toContain('model crashed')
  })

  it('forwards streamed tokens to an external emit when provided', async () => {
    const session = mkSession(fakeRunner('retry streamed'))
    ;(session as unknown as { spawnedSubagentIds: Set<string> }).spawnedSubagentIds.add('worker-emit')
    ;(session as unknown as { subagentInstances: Map<string, { description: string }> }).subagentInstances.set('worker-emit', { description: 'original task' })

    const emitted: string[] = []
    const emit: GraphEmit = {
      token: (delta) => emitted.push(delta),
      reasoning: () => {},
      toolStarted: () => {},
      toolFinished: () => {},
      usage: () => {},
      planDelta: () => {},
      compaction: () => {},
    }

    const result = await session.retrySubagent('worker-emit', fakeSend, emit)
    expect(result).toBe('retry streamed')
    expect(emitted).toContain('retry streamed')
    // With emit provided, retrySubagent does not send its own agent:started/finished lifecycle events
    expect(fakeSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'agent:started', agentId: 'worker-emit' }))
    expect(fakeSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'agent:finished', agentId: 'worker-emit' }))
  })
})

// ── End-to-end: task → failure → task_retry → success ──────────────────────

describe('retrySubagent end-to-end flow', () => {
  it('retrySubagent succeeds after a prior failure preserves context', async () => {
    const runner = new CapturingRunner('e2e retry ok')
    const session = new Session('e2e', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as never, undefined, undefined, undefined, 60_000, runner)
    ;(session as unknown as { spawnedSubagentIds: Set<string> }).spawnedSubagentIds.add('worker-e2e')
    ;(session as unknown as { subagentInstances: Map<string, { description: string }> }).subagentInstances.set('worker-e2e', { description: 'research feature X' })

    const storedMessages = [
      { role: 'user' as const, content: 'research feature X' },
      { role: 'assistant' as const, content: 'Error: API rate limit exceeded' },
    ]
    ;(session as unknown as { store: { getMessages: (id: string) => { role: string; content: string }[] } }).store = {
      getMessages: () => storedMessages,
    } as never

    const fakeSend = vi.fn()
    const result = await session.retrySubagent('worker-e2e', fakeSend)

    expect(result).toBe('e2e retry ok')
    expect(fakeSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent:started', agentId: 'worker-e2e' }))
    expect(fakeSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent:finished', agentId: 'worker-e2e' }))

    // Context preserved: the prior context (before last user message) should be empty
    // since there was only one human message and its failed response
    expect(runner.captured.length).toBe(2) // system + human (fresh start — no prior context)
  })
})
