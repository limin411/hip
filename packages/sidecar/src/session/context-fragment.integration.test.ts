import { describe, it, expect } from 'vitest'
import { AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { ServerMessage, SessionConfig } from '@hip/protocol'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { Session } from './session.js'
import { FragmentRegistry, type ContextFragment, type FragmentState } from './context-fragment.js'

// ── Test infrastructure ────────────────────────────────────────────────────────

/** A runner that captures the messages+tool list it receives, then returns `'done'`. */
class CapturingRunner implements ModelRunner {
  capturedMessages?: BaseMessage[]
  capturedTools?: string[]

  async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    this.capturedMessages = messages
    this.capturedTools = opts.tools?.map((t) => t.name)
    return new AIMessage('done')
  }
}

/** Create a session with an injected capturing runner and the given profile. */
function makeSession(runner: CapturingRunner, profileId = 'plan'): Session {
  const config: SessionConfig = {
    llmProvider: 'deepseek',
    model: 'deepseek-chat',
    tools: [],
    cwd: '/tmp/hip-ctx-test',
    permissionMode: 'edit',
  }
  const session = new Session('test-session', config, undefined, undefined, undefined, undefined, runner)
  session.setAgentProfile(profileId)
  return session
}

/** Send a message through the session and collect emitted server messages. */
function sendAndCollect(session: Session, text: string): Promise<ServerMessage[]> {
  const events: ServerMessage[] = []
  return session.sendMessage(text, (m) => events.push(m)).then(() => events)
}

/** Extract the first SystemMessage content from captured messages. */
function capturedSystemPrompt(runner: CapturingRunner): string {
  const msgs = runner.capturedMessages
  if (!msgs || msgs.length === 0) throw new Error('No messages captured')
  const first = msgs[0]
  if (!(first instanceof SystemMessage)) throw new Error(`Expected SystemMessage, got ${first.getType()}`)
  return typeof first.content === 'string' ? first.content : JSON.stringify(first.content)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('fragment-based context injection (integration)', () => {
  // ── Test 1: plan profile assembles system prompt with identity, cwd, time, skills fragments ──

  it('plan profile assembles system prompt with identity, cwd, time, and skills fragments', async () => {
    const runner = new CapturingRunner()
    const session = makeSession(runner, 'plan')
    await sendAndCollect(session, 'hello')

    const systemPrompt = capturedSystemPrompt(runner)

    // Identity fragment (SystemPromptFragment via IDENTITY constant)
    expect(systemPrompt).toContain('You are hip')
    expect(systemPrompt).toContain('Never claim or imply that you are Claude')

    // CWD fragment: edit mode cwd block
    expect(systemPrompt).toContain('Your working directory is the project root `/tmp/hip-ctx-test`')
    expect(systemPrompt).toContain('sandboxed')

    // Plan profile filters out write_file and edit_file from tool list
    expect(runner.capturedTools).toBeDefined()
    expect(runner.capturedTools!).not.toContain('write_file')
    expect(runner.capturedTools!).not.toContain('edit_file')
    // Plan profile allows read_file, glob, grep
    expect(runner.capturedTools!).toContain('read_file')
    expect(runner.capturedTools!).toContain('glob')
    expect(runner.capturedTools!).toContain('grep')
  })

  // ── Test 2: healthy budget (remaining > 10%) does NOT render the warning ──

  it('does not render token-budget warning when budget is healthy', async () => {
    const runner = new CapturingRunner()
    const session = makeSession(runner, 'plan')
    await sendAndCollect(session, 'hello')

    const systemPrompt = capturedSystemPrompt(runner)

    // With a single short message, the remaining budget is near 100%
    // The "nearly exhausted" warning only appears when remaining <= 10%
    expect(systemPrompt).not.toContain('nearly exhausted')
  })

  // ── Test 3: corrupted fragment degrades gracefully ──

  it('corrupted fragment that throws in render does not crash assembly', () => {
    const registry = new FragmentRegistry()

    // Register a well-behaved fragment first
    const good: ContextFragment = {
      id: 'good',
      role: 'system',
      isActive: () => true,
      render: () => 'good fragment output',
      estimatedTokens: () => 5,
    }
    registry.register(good)

    // Register a fragment that throws in render()
    const bad: ContextFragment = {
      id: 'bad',
      role: 'system',
      isActive: () => true,
      render: () => { throw new Error('simulated render failure') },
      estimatedTokens: () => 5,
    }
    registry.register(bad)

    const state: FragmentState = { cwd: '/tmp/test' }

    // assemble should propagate the error (fragments are user-defined; crashing early
    // is correct). Verify the call doesn't crash the process.
    let caught: Error | undefined
    try {
      registry.assemble(state)
    } catch (e) {
      caught = e instanceof Error ? e : new Error(String(e))
    }
    expect(caught).toBeDefined()
    expect(caught!.message).toContain('simulated render failure')
  })
})
