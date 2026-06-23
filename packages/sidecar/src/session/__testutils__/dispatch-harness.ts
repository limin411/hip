import { FakeListChatModel } from '@langchain/core/utils/testing'
import { AIMessageChunk } from '@langchain/core/messages'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentConfig, ServerMessage } from '@hip/protocol'
import { Session } from '../session.js'
import type { AgentInvoker } from '../agents/invoker.js'
import { RealModelRunner, type ModelRunner } from '../model-runner.js'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

/** Supervisor model: 1st call emits a dispatch_agent tool call, 2nd call emits final text.
 *  Mirrors session-unit.test.ts's HangingChatModel: bindTools returns `this` so the streaming
 *  override survives (FakeListChatModel.bindTools otherwise rebuilds a plain base instance). */
class ToolThenTextModel extends FakeListChatModel {
  private call = 0
  constructor(private readonly args: { agent: string; task: string }, private readonly finalText: string) {
    super({ responses: ['unused'] })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bindTools(): any { return this }
  async *_streamResponseChunks(): AsyncGenerator<ChatGenerationChunk> {
    this.call += 1
    if (this.call === 1) {
      yield new ChatGenerationChunk({
        text: '',
        message: new AIMessageChunk({
          content: '',
          tool_calls: [{ name: 'dispatch_agent', args: this.args, id: 'call-1', type: 'tool_call' }],
        }),
      })
    } else {
      yield new ChatGenerationChunk({ text: this.finalText, message: new AIMessageChunk({ content: this.finalText }) })
    }
  }
}
export function makeToolCallingModel(args: { agent: string; task: string }, finalText: string): ToolThenTextModel {
  return new ToolThenTextModel(args, finalText)
}

const tmpDirs: string[] = []

/** Write a one-agent hip-agents.json and point HIP_AGENTS_PATH at it (see registry.test.ts). */
export function registerAgent(agent: Partial<AgentConfig> = {}): string {
  const full: AgentConfig = {
    id: 'echo', name: 'Echo', kind: 'acp', command: 'x', args: [],
    enabled: true, ...agent,
  }
  const dir = mkdtempSync(join(tmpdir(), 'hip-dispatch-'))
  tmpDirs.push(dir)
  const p = join(dir, 'hip-agents.json')
  writeFileSync(p, JSON.stringify({ agents: [full] }))
  process.env.HIP_AGENTS_PATH = p
  return full.id
}

/** Remove the temp agent files and clear the env (call in afterEach), matching registry.test.ts. */
export function cleanupAgents(): void {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
  delete process.env.HIP_AGENTS_PATH
}

export type StubInvoke = AgentInvoker['invoke']

/** Session whose AgentInvoker is stubbed (no real sub-agent process). invokerFactory is the LAST
 *  constructor param, so the intervening optional params are passed undefined to reach it. */
export function makeSession(id: string, model: ToolThenTextModel, stub: StubInvoke): Session {
  const invokerFactory = (): AgentInvoker => ({ invoke: stub })
  return new Session(
    id,
    { llmProvider: 'deepseek', model: 'm', tools: [], cwd: process.cwd() },
    model as BaseChatModel,
    undefined, // store
    undefined, // titleGenerator
    undefined, // idleTimeoutMs
    undefined, // runner
    undefined, // summarizer
    invokerFactory,
  )
}

/** Drive one turn; resolve on the turn's terminal event. `onMessage` may respond mid-turn. */
export function collect(session: Session, text: string, onMessage?: (m: ServerMessage) => void): Promise<ServerMessage[]> {
  const out: ServerMessage[] = []
  return new Promise<ServerMessage[]>((resolve) => {
    session
      .sendMessage(text, (m: ServerMessage) => {
        out.push(m)
        onMessage?.(m)
        if (m.type === 'message:complete' || m.type === 'error') resolve(out)
      })
      .catch(() => resolve(out)) // never hang the test if the turn rejects unexpectedly
  })
}

/** A fake chat model that always answers with `text` (no tool calls); tool-binding is a no-op.
 *  Mirrors ToolThenTextModel's bindTools/_streamResponseChunks override so RealModelRunner can stream it. */
export class TextOnlyModel extends FakeListChatModel {
  constructor(private readonly text: string) { super({ responses: [text] }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bindTools(): any { return this }
  async *_streamResponseChunks(): AsyncGenerator<ChatGenerationChunk> {
    yield new ChatGenerationChunk({ text: this.text, message: new AIMessageChunk({ content: this.text }) })
  }
}

/** A ModelRunner over a TextOnlyModel — used as the internal child's runner so no API is hit. */
export function makeTextRunner(text: string): ModelRunner {
  return new RealModelRunner(new TextOnlyModel(text) as BaseChatModel)
}

/** Session that uses a REAL AgentInvoker (built by invokerFactory) so the internal-agent loop runs.
 *  invokerFactory is the LAST Session constructor param. */
export function makeSessionWithInvokerFactory(
  id: string,
  model: ReturnType<typeof makeToolCallingModel>,
  invokerFactory: (cwd: string) => AgentInvoker,
): Session {
  return new Session(
    id,
    { llmProvider: 'deepseek', model: 'm', tools: [], cwd: process.cwd() },
    model as BaseChatModel,
    undefined, // store
    undefined, // titleGenerator
    undefined, // idleTimeoutMs
    undefined, // runner
    undefined, // summarizer
    invokerFactory,
  )
}
