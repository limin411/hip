import { describe, it, expect, afterEach } from 'vitest'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { AgentConfig, PermissionMode, ServerMessage } from '@hip/protocol'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { AgentInvoker, InvokerExtras } from './agents/invoker.js'
import { registerAgent, cleanupAgents } from './__testutils__/dispatch-harness.js'

afterEach(() => cleanupAgents())

/** Reads the SystemMessage text from the graph's message[0] regardless of string/array content. */
function systemText(messages: BaseMessage[]): string {
  const sys = messages[0]
  const c = sys?.content
  if (typeof c === 'string') return c
  return Array.isArray(c)
    ? c.map((b) => (typeof b === 'string' ? b : (b as { text?: string }).text ?? '')).join('')
    : ''
}

/** A ModelRunner that records the system prompt + bound tool names it was handed, then answers
 *  with plain final text (no tool calls). Lets us assert what `runTurn` cascaded into the loop. */
class CapturingRunner implements ModelRunner {
  systemPrompt = ''
  toolNames: string[] = []
  async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    this.systemPrompt = systemText(messages)
    this.toolNames = opts.tools.map((t) => t.name)
    opts.onText('done')
    return new AIMessage('done')
  }
}

/** A ModelRunner that issues a single dispatch_agent tool call on its first run, then final text. */
class DispatchThenTextRunner implements ModelRunner {
  toolNames: string[] = []
  private call = 0
  constructor(private readonly agentId: string) {}
  async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    this.call += 1
    this.toolNames = opts.tools.map((t) => t.name)
    if (this.call === 1) {
      return new AIMessage({
        content: '',
        tool_calls: [{ name: 'dispatch_agent', args: { agent: this.agentId, task: 'go' }, id: 'c1', type: 'tool_call' }],
      })
    }
    opts.onText('final')
    return new AIMessage('final')
  }
}

function makeRunnerSession(
  id: string,
  mode: PermissionMode | undefined,
  runner: ModelRunner,
  invokerFactory?: (cwd: string) => AgentInvoker,
  surface?: 'chat' | 'code',
): Session {
  return new Session(
    id,
    {
      llmProvider: 'deepseek',
      model: 'm',
      tools: [],
      cwd: process.cwd(),
      ...(mode ? { permissionMode: mode } : {}),
      ...(surface ? { surface } : {}),
    },
    undefined, // model
    undefined, // store
    undefined, // titleGenerator
    undefined, // idleTimeoutMs
    runner,
    undefined, // summarizer
    invokerFactory,
  )
}

function drive(session: Session, text: string, onMessage?: (m: ServerMessage) => void): Promise<ServerMessage[]> {
  const out: ServerMessage[] = []
  return new Promise<ServerMessage[]>((resolve) => {
    session
      .sendMessage(text, (m: ServerMessage) => { out.push(m); onMessage?.(m); if (m.type === 'message:complete' || m.type === 'error') resolve(out) })
      .catch(() => resolve(out))
  })
}

describe('runTurn permissionMode cascade — system prompt + buildTools', () => {
  it("threads 'chat' into buildSystemPrompt (read-only cwd block) and buildTools (no write_file/run_script)", async () => {
    const runner = new CapturingRunner()
    const session = makeRunnerSession('s-chat', 'chat', runner)
    await drive(session, 'hi')
    expect(runner.systemPrompt).toContain('READ-ONLY mode')
    expect(runner.toolNames).not.toContain('write_file')
    expect(runner.toolNames).not.toContain('edit_file')
    expect(runner.toolNames).not.toContain('run_script')
    expect(runner.toolNames).toContain('read_file')
  })

  it("threads 'full' into buildSystemPrompt (not sandboxed) and buildTools (write_file + run_script)", async () => {
    const runner = new CapturingRunner()
    const session = makeRunnerSession('s-full', 'full', runner)
    await drive(session, 'hi')
    expect(runner.systemPrompt).toContain('NOT sandboxed')
    expect(runner.toolNames).toContain('write_file')
    expect(runner.toolNames).toContain('run_script')
  })

  it("default (no permissionMode) cascades as 'edit' — sandboxed prompt + write_file + run_script", async () => {
    const runner = new CapturingRunner()
    const session = makeRunnerSession('s-default', undefined, runner)
    await drive(session, 'hi')
    expect(runner.systemPrompt).toContain('sandboxed to it')
    expect(runner.toolNames).toContain('write_file')
    expect(runner.toolNames).toContain('run_script')
  })

  it("Chat surface + permissionMode edit: Chat body, write tools, never bare 'edit mode' narrative", async () => {
    const runner = new CapturingRunner()
    const session = makeRunnerSession('s-chat-surface', 'edit', runner, undefined, 'chat')
    await drive(session, 'hi')
    expect(runner.systemPrompt).toMatch(/Chat assistant|private sandbox|Chat surface/i)
    expect(runner.systemPrompt).not.toMatch(/Current permission mode:\s*edit/i)
    expect(runner.systemPrompt).toMatch(/not.*Code edit mode|not the Code project/i)
    expect(runner.systemPrompt).not.toMatch(/task_batch/)
    expect(runner.toolNames).toContain('write_file')
    expect(runner.toolNames).not.toContain('git_commit')
  })
})

describe('runTurn permissionMode cascade — dispatched agents + per-mode requestApproval', () => {
  const internalAgent: Partial<AgentConfig> = {
    id: 'reviewer', name: 'Reviewer', kind: 'internal', prompt: 'review', enabled: true, allowedTools: ['read_file'],
  }

  /** Capture the InvokerExtras the dispatch path cascaded into the sub-agent. */
  function captureDispatch(mode: PermissionMode | undefined): Promise<InvokerExtras | undefined> {
    registerAgent(internalAgent)
    let captured: InvokerExtras | undefined
    const invokerFactory = (): AgentInvoker => ({
      async invoke(_id, _task, emit, _signal, _hooks, extras) {
        captured = extras
        emit.token('child-done')
        return 'child-done'
      },
    })
    const runner = new DispatchThenTextRunner('reviewer')
    const session = makeRunnerSession(`s-dispatch-${mode ?? 'def'}`, mode, runner, invokerFactory)
    return drive(session, 'please review').then(() => captured)
  }

  it("chat mode cascades permissionMode 'chat' AND requestApproval undefined (no run_script for the child)", async () => {
    const extras = await captureDispatch('chat')
    expect(extras?.permissionMode).toBe('chat')
    expect(extras?.requestApproval).toBeUndefined()
  })

  it("full mode cascades permissionMode 'full' AND an auto-approving requestApproval (resolves allow without a modal)", async () => {
    const extras = await captureDispatch('full')
    expect(extras?.permissionMode).toBe('full')
    expect(typeof extras?.requestApproval).toBe('function')
    // full ⇒ auto-approve: the cascaded fn resolves immediately to an allow decision (no permission:request).
    await expect(extras!.requestApproval!({ title: 't', kind: 'execute' })).resolves.toEqual({ kind: 'allow_once' })
  })

  it("edit mode (default) cascades permissionMode 'edit' AND a real HITL requestApproval that emits permission:request", async () => {
    registerAgent(internalAgent)
    // Capture the InvokerExtras AND drive the cascaded HITL closure from INSIDE the dispatch (during
    // the live turn) so the closure's send() reaches the turn's event stream.
    let captured: InvokerExtras | undefined
    let approvalResult: unknown
    const invokerFactory = (): AgentInvoker => ({
      async invoke(_id, _task, emit, _signal, _hooks, extras) {
        captured = extras
        // edit ⇒ a real HITL closure: calling it must emit a permission:request and block until respond.
        approvalResult = await extras!.requestApproval!({ title: 'run x', kind: 'execute' })
        emit.token('child-done')
        return 'child-done'
      },
    })
    const runner = new DispatchThenTextRunner('reviewer')
    const session = makeRunnerSession('s-dispatch-edit', 'edit', runner, invokerFactory)
    const events = await drive(session, 'please review', (m) => {
      if (m.type === 'permission:request') session.respondPermission(m.requestId, { optionId: 'allow_once' })
    })
    expect(captured?.permissionMode).toBe('edit')
    expect(typeof captured?.requestApproval).toBe('function')
    expect(events.some((e) => e.type === 'permission:request')).toBe(true)
    expect(approvalResult).toEqual({ kind: 'allow_once' })
  })
})
