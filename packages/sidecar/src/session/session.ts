import type { ServerMessage, SessionConfig, AgentRole, Message, AgentRun, FsEntry } from '@hip/protocol'
import { createDeepAgent, FilesystemBackend } from 'deepagents'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import { buildSubagents, buildSupervisorPrompt, roleForName } from './agents.js'
import type { SessionStore } from '../persistence/store.js'
import * as workspaceFs from './workspace-fs.js'
import { consumeToolCalls, trajectoryToRuns, trajectoryToTimeline, ReasoningTracker, type TraceRun, type TraceRecorder } from './tool-trace.js'
import { verifyWrites } from './verify.js'
import { IdleWatchdog } from './idle-watchdog.js'

type SendFn = (msg: ServerMessage) => void

const TITLE_MODEL = 'deepseek-chat'
const TITLE_LEN = 40

/** A turn with no outbound activity for this long is treated as a stalled provider stream and aborted. */
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000

/** thinking === false → fast non-reasoning model; otherwise the reasoner (default). A caller-pinned config.model still wins. */
export function resolveModel(config: SessionConfig): string {
  return config.model || (config.thinking === false ? 'deepseek-chat' : 'deepseek-reasoner')
}

function deriveTitle(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > TITLE_LEN ? oneLine.slice(0, TITLE_LEN) + '…' : oneLine || '新对话'
}

/** Normalize a generated/echoed title: one line, no wrapping quotes, no trailing punctuation, bounded length. */
export function sanitizeTitle(raw: string): string {
  const oneLine = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'""''「」『』]+/, '')
    .replace(/["'""''「」『』]+$/, '')
    .replace(/[。.！!？?，,、；;：:]+$/, '')
    .trim()
  return oneLine.length > TITLE_LEN ? oneLine.slice(0, TITLE_LEN) : oneLine
}

export type TitleGenerator = (input: { firstUserMessage: string; firstReply: string }) => Promise<string>


const TITLE_SYSTEM_PROMPT =
  'You generate a very short title (at most 6 words, or about 16 Chinese characters) for a chat conversation. ' +
  'Use the same language as the user. Reply with ONLY the title — no quotes, no trailing punctuation.'

/** Production title generator: one cheap DeepSeek completion. Not used when a model is injected (tests). */
function buildDefaultTitleGenerator(_config: SessionConfig): TitleGenerator {
  return async ({ firstUserMessage, firstReply }) => {
    const model = new ChatOpenAI({
      model: TITLE_MODEL,
      apiKey: process.env.DEEPSEEK_API_KEY || 'sk-missing',
      configuration: { baseURL: 'https://api.deepseek.com/v1' },
      maxTokens: 24,
      temperature: 0.3,
    })
    const res = await model.invoke([
      new SystemMessage(TITLE_SYSTEM_PROMPT),
      new HumanMessage(`${firstUserMessage}\n\n[assistant reply]: ${firstReply.slice(0, 200)}`),
    ])
    return typeof res.content === 'string' ? res.content : ''
  }
}

/** Stable content-block index for the re-projected reasoning block — distinct from text (0)
 *  and tool-call chunk indices so it accumulates as its own block in convertChunksToEvents. */
const REASONING_BLOCK_INDEX = 7

/** Strip re-projected `reasoning`/`thinking` content blocks from a message's content so they never
 *  reach the OpenAI request body. langchain's v0 outbound converter passes array blocks through raw,
 *  and these blocks also leak into ToolMessages (which carry no output_version tag and so bypass the
 *  v1 text-only filter), making DeepSeek 400 ("unknown variant `reasoning`"). Mutates in place. */
function stripReasoningBlocks(messages: readonly { content: unknown }[]): void {
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue
    const kept = m.content.filter((b) => {
      const t = (b as { type?: unknown } | null)?.type
      return t !== 'reasoning' && t !== 'thinking'
    })
    if (kept.length === m.content.length) continue
    // Collapse to a plain string when only a single text block survives (the common case),
    // else keep the filtered array. Empty → '' so the assistant turn still serializes.
    if (kept.length === 1 && (kept[0] as { type?: unknown }).type === 'text') {
      ;(m as { content: unknown }).content = (kept[0] as { text?: string }).text ?? ''
    } else {
      ;(m as { content: unknown }).content = kept.length === 0 ? '' : kept
    }
  }
}

/**
 * @langchain/openai surfaces DeepSeek chain-of-thought ONLY as
 * additional_kwargs.reasoning_content; langchain-core's v3 stream-event producer reads
 * `content` and ignores additional_kwargs, so ChatModelStream.reasoning (deepagents'
 * msg.reasoning) is empty. Re-project each reasoning delta into a typed `reasoning`
 * content block (stable index) so 2nd+ chunks emit `reasoning-delta` events that feed
 * `.reasoning`. That block accumulates into langgraph's message state, so on the *next*
 * request we strip it back out (stripReasoningBlocks) before super builds the outbound body —
 * otherwise DeepSeek 400s on the re-serialized `reasoning` block. withConfig is overridden too:
 * ChatOpenAI.withConfig rebuilds a plain ChatOpenAI from `this.fields`, which would drop this
 * subclass (deepagents calls withConfig).
 */
class ReasoningChatOpenAI extends ChatOpenAI {
  async *_streamResponseChunks(
    messages: Parameters<ChatOpenAI['_streamResponseChunks']>[0],
    options: Parameters<ChatOpenAI['_streamResponseChunks']>[1],
    runManager?: Parameters<ChatOpenAI['_streamResponseChunks']>[2],
  ): ReturnType<ChatOpenAI['_streamResponseChunks']> {
    stripReasoningBlocks(messages)
    for await (const chunk of super._streamResponseChunks(messages, options, runManager)) {
      const msg = chunk.message as unknown as { content: unknown; additional_kwargs?: { reasoning_content?: unknown } }
      const rc = msg.additional_kwargs?.reasoning_content
      if (typeof rc === 'string' && rc.length > 0 && typeof msg.content === 'string') {
        const blocks: Array<Record<string, unknown>> = [{ type: 'reasoning', reasoning: rc, index: REASONING_BLOCK_INDEX }]
        if (msg.content.length > 0) blocks.push({ type: 'text', text: msg.content, index: 0 })
        msg.content = blocks as unknown as string
      }
      yield chunk
    }
  }

  withConfig(config: Parameters<ChatOpenAI['withConfig']>[0]): ReasoningChatOpenAI {
    const f = (this as unknown as { fields: ConstructorParameters<typeof ChatOpenAI>[0] }).fields
    const m = new ReasoningChatOpenAI(f)
    ;(m as unknown as { defaultOptions: unknown }).defaultOptions = {
      ...(this as unknown as { defaultOptions: Record<string, unknown> }).defaultOptions,
      ...config,
    }
    return m
  }
}

function buildModel(config: SessionConfig): ChatOpenAI {
  return new ReasoningChatOpenAI({
    model: resolveModel(config),
    apiKey: process.env.DEEPSEEK_API_KEY || 'sk-missing',
    configuration: {
      baseURL: 'https://api.deepseek.com/v1',
    },
  })
}

/** Resolve a sub-agent's delegation instruction defensively (it is known at delegation time). */
async function safeTaskInput(sub: { taskInput: Promise<string> }): Promise<string | undefined> {
  try {
    return await sub.taskInput
  } catch {
    return undefined
  }
}

export class Session {
  private agent!: ReturnType<typeof createDeepAgent>
  private _config: SessionConfig
  private readonly injectedModel?: BaseLanguageModel
  private readonly messages: BaseMessage[] = []
  private abortController: AbortController | null = null
  // Re-entrancy guard: a second send/regenerate while a turn is in flight is dropped (the WS layer dispatches fire-and-forget, so it does not serialize).
  private running = false
  // Monotonic per-session turn counter — appended to turnId so two turns in the same millisecond cannot collide.
  private turnSeq = 0
  private readonly usesEnvModel: boolean
  private readonly titleGenerator?: TitleGenerator

  constructor(
    readonly id: string,
    config: SessionConfig,
    model?: BaseLanguageModel,
    private readonly store?: SessionStore,
    titleGenerator?: TitleGenerator,
    private readonly idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
  ) {
    this._config = config
    this.injectedModel = model
    this.usesEnvModel = !model
    // Inject a generator (tests), else build the real one only for the env-keyed
    // production model. Injected-model sessions get no generator → no LLM title.
    this.titleGenerator = titleGenerator ?? (this.usesEnvModel ? buildDefaultTitleGenerator(config) : undefined)
    this.buildAgent()
  }

  /** Current config (cwd may change via setCwd). */
  get config(): SessionConfig {
    return this._config
  }

  /** (Re)build the deep agent — with a sandboxed FilesystemBackend when a cwd is bound. */
  private buildAgent(): void {
    const model = this.injectedModel ?? buildModel(this._config)
    const backend = this._config.cwd
      ? new FilesystemBackend({ rootDir: this._config.cwd, virtualMode: true, maxFileSizeMb: 10 })
      : undefined
    const promptCwd = this._config.cwd ?? '/'
    this.agent = createDeepAgent({
      model,
      systemPrompt: this._config.systemPrompt ?? buildSupervisorPrompt(promptCwd),
      subagents: buildSubagents(promptCwd) as unknown as NonNullable<Parameters<typeof createDeepAgent>[0]>['subagents'],
      ...(backend ? { backend } : {}),
    })
  }

  /** Seed prior conversation so the agent resumes with full context. */
  hydrate(messages: Message[]): void {
    for (const m of messages) {
      this.messages.push(m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content))
    }
  }

  /** Bind/replace the project directory and rebuild the agent. Conversation history is preserved. */
  setCwd(cwd: string): void {
    this._config = { ...this._config, cwd }
    this.buildAgent()
  }

  /** Toggle the thinking (reasoner) model and rebuild the agent. NO-OP (returns false) while a turn is running. */
  setThinking(thinking: boolean): boolean {
    if (this.running) return false
    this._config = { ...this._config, thinking }
    this.buildAgent()
    return true
  }

  /** List a directory for the UI tree. Absolute path. */
  async lsDir(absPath: string): Promise<{ entries?: FsEntry[]; error?: string }> {
    if (!this._config.cwd) return { error: 'no_workspace' }
    try {
      return { entries: await workspaceFs.lsDir(this._config.cwd, absPath) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Read a file for the UI preview. Absolute path. */
  async readForPreview(absPath: string): Promise<workspaceFs.PreviewResult> {
    if (!this._config.cwd) return { error: 'no_workspace' }
    try {
      return await workspaceFs.readForPreview(this._config.cwd, absPath)
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Emit NO_API_KEY and return false when the env-keyed model has no key. */
  private requireApiKey(send: SendFn): boolean {
    if (this.usesEnvModel && !process.env.DEEPSEEK_API_KEY?.trim()) {
      send({ type: 'error', sessionId: this.id, code: 'NO_API_KEY', message: 'DeepSeek API key not configured. Set it in Settings.' })
      return false
    }
    return true
  }

  async sendMessage(content: string, _send: SendFn, userMessageId?: string): Promise<void> {
    if (this.running) return
    if (!this.requireApiKey(_send)) return

    // Persist the user message + bump/derive session metadata before running.
    const userTs = Date.now()
    let isFirstTurn = false
    if (this.store) {
      const seq = this.store.insertMessage({ id: userMessageId ?? `u-${userTs}`, sessionId: this.id, role: 'user', agentId: null, content, timestamp: userTs })
      this.store.touchSession(this.id, userTs)
      isFirstTurn = seq === 1
      if (isFirstTurn) {
        const title = deriveTitle(content)
        if (this.store.updateTitleIfAuto(this.id, title) === 1) {
          _send({ type: 'session:title', sessionId: this.id, title })
        }
      }
    }

    this.messages.push(new HumanMessage(content))
    const supervisorText = await this.runTurn(_send)

    // Auto-title refine: once, on the first turn, only while still auto-titled.
    if (isFirstTurn && this.titleGenerator && supervisorText && this.store) {
      try {
        const refined = sanitizeTitle(await this.titleGenerator({ firstUserMessage: content, firstReply: supervisorText }))
        if (refined && this.store.updateTitleIfAuto(this.id, refined) === 1) {
          _send({ type: 'session:title', sessionId: this.id, title: refined })
        }
      } catch {
        // swallow: the title is non-critical
      }
    }
  }

  /** Stream one turn for the HumanMessage already at the tail of this.messages.
   *  Returns the supervisor text on clean completion, or '' on abort/error. */
  private async runTurn(rawSend: SendFn): Promise<string> {
    this.abortController = new AbortController()
    this.running = true
    let timedOut = false
    const watchdog = new IdleWatchdog(this.idleTimeoutMs, () => { timedOut = true; this.abortController?.abort() })
    // Every outbound activity kicks the watchdog; a stall (no sends for idleTimeoutMs) aborts the turn.
    const send: SendFn = (msg) => { watchdog.kick(); rawSend(msg) }

    const turnId = `asst-supervisor-${Date.now()}-${this.turnSeq++}`
    const trajectory = new Map<string, TraceRun>()
    let agentSeq = 0
    // ONE turn-global step counter shared by tool calls AND reasoning bursts, so the timeline
    // interleaves them in true wall-clock order.
    let stepSeq = 0
    const nextSeq = () => stepSeq++
    const pending: Promise<void>[] = []
    const started = new Set<string>()
    const recorder: TraceRecorder = {
      start: (agentId, callId, name, input, seq, truncated) => {
        const r = trajectory.get(agentId)
        if (r) r.toolCalls.set(callId, { callId, agentId, name, input, status: 'running', seq, ...(truncated ? { truncated: true } : {}) })
      },
      finish: (agentId, callId, status, output, error, truncated) => {
        const tc = trajectory.get(agentId)?.toolCalls.get(callId)
        if (!tc) return
        tc.status = status
        if (output !== undefined) tc.output = output
        if (error !== undefined) tc.error = error
        if (truncated || tc.truncated) tc.truncated = true   // sticky-OR
      },
    }
    // An open reasoning burst per agent: the first reasoning delta opens it (claiming a stepSeq);
    // subsequent deltas append at that same stepSeq; a tool-start or agent-finish closes it.
    const reasoning = new ReasoningTracker(nextSeq)
    const reasoningDelta = (agentId: string, role: AgentRole, delta: string) => {
      if (!delta) return
      const stepSeq = reasoning.push(agentId, delta)
      send({ type: 'reasoning:delta', sessionId: this.id, turnId, agentId, role, stepSeq, delta })
    }
    const closeReasoning = (agentId: string) => {
      const burst = reasoning.close(agentId)
      if (burst) { const r = trajectory.get(agentId); if (r) r.reasoningBursts.push(burst) }
    }
    const traceCtx = {
      sessionId: this.id,
      turnId,
      send,
      nextSeq,
      roleOf: (agentId: string) => trajectory.get(agentId)?.role ?? 'supervisor',
      onToolStart: (agentId: string) => closeReasoning(agentId),
      pending,
      record: recorder,
    }
    const ensureStarted = (agentId: string, role: AgentRole, parentAgentId?: string, taskInput?: string) => {
      if (started.has(agentId)) return
      started.add(agentId)
      trajectory.set(agentId, { role, output: '', startedAt: Date.now(), finishedAt: null, seq: agentSeq++, toolCalls: new Map(), reasoningBursts: [], ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}) })
      send({ type: 'agent:started', sessionId: this.id, turnId, agentId, role, ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}) })
    }
    const finishRemaining = () => {
      for (const id of started) {
        closeReasoning(id)
        const r = trajectory.get(id); if (r) r.finishedAt = Date.now()
        send({ type: 'agent:finished', sessionId: this.id, turnId, agentId: id })
      }
      started.clear()
    }

    let supervisorText = ''
    ensureStarted('supervisor', 'supervisor')
    try {
      const run = await this.agent.streamEvents(
        { messages: this.messages },
        { version: 'v3', signal: this.abortController.signal },
      )
      // Supervisor and subagent message streams are the same ChatModelStream shape at runtime
      // (streaming `.text` + `.reasoning`), but the subagents projection's static type collapses
      // to AIMessage (whose `.text` is a plain string and has no `.reasoning`) because the
      // subagent specs are passed through an `as unknown` cast in buildAgent. Re-project the
      // subagent message to the supervisor stream's element type so both pumps read tokens.
      type StreamedMessage = typeof run.messages extends AsyncIterable<infer M> ? M : never
      const pumpSupervisor = async () => {
        for await (const msg of run.messages) {
          await Promise.all([
            (async () => { for await (const delta of msg.text) {
              if (!delta) continue
              supervisorText += delta
              const r = trajectory.get('supervisor'); if (r) r.output += delta
              send({ type: 'token:stream', sessionId: this.id, turnId, agentId: 'supervisor', delta })
            } })(),
            (async () => { for await (const delta of msg.reasoning) { reasoningDelta('supervisor', 'supervisor', delta) } })(),
          ])
        }
      }
      const pumpSubagents = async () => {
        for await (const sub of run.subagents) {
          const agentId = sub.name
          const taskInput = await safeTaskInput(sub)
          ensureStarted(agentId, roleForName(sub.name), 'supervisor', taskInput)
          await Promise.all([
            (async () => {
              for await (const rawMsg of sub.messages) {
                const msg = rawMsg as unknown as StreamedMessage
                await Promise.all([
                  (async () => { for await (const delta of msg.text) {
                    if (!delta) continue
                    const r = trajectory.get(agentId); if (r) r.output += delta
                    send({ type: 'token:stream', sessionId: this.id, turnId, agentId, delta })
                  } })(),
                  (async () => { for await (const delta of msg.reasoning) { reasoningDelta(agentId, roleForName(sub.name), delta) } })(),
                ])
              }
            })(),
            consumeToolCalls(agentId, sub.toolCalls, traceCtx),
          ])
          if (started.delete(agentId)) {
            closeReasoning(agentId)
            const r = trajectory.get(agentId); if (r) r.finishedAt = Date.now()
            send({ type: 'agent:finished', sessionId: this.id, turnId, agentId })
          }
        }
      }
      await Promise.all([pumpSupervisor(), pumpSubagents(), consumeToolCalls('supervisor', run.toolCalls, traceCtx)])
      await Promise.allSettled(pending)
      finishRemaining()
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      finishRemaining()
      await Promise.allSettled(pending)
      if (isAbort && supervisorText) {
        // Keep the partial: finalize + persist with stopped=true (also enters next-turn context).
        const text = this.finalizeAndPersist(rawSend, turnId, supervisorText, trajectory, true)
        // A stall is terminal: emit TIMEOUT *after* the finalize so the client ends in `error`, not `idle`.
        if (timedOut) rawSend({ type: 'error', sessionId: this.id, code: 'TIMEOUT', message: '' })
        return text
      }
      rawSend({
        type: 'error',
        sessionId: this.id,
        code: timedOut ? 'TIMEOUT' : isAbort ? 'CANCELLED' : 'AGENT_ERROR',
        message: timedOut ? '' : isAbort ? 'User cancelled the request' : err instanceof Error ? err.message : String(err),
      })
      return ''
    } finally {
      watchdog.stop()
      this.running = false
      this.abortController = null
    }

    return this.finalizeAndPersist(send, turnId, supervisorText, trajectory, false)
  }

  /** Run the phantom-write safety net, push the assistant message into context, persist the turn
   *  (with its timeline), and emit message:complete. Returns the final (possibly corrected) text. */
  private finalizeAndPersist(send: SendFn, turnId: string, supervisorText: string, trajectory: Map<string, TraceRun>, stopped: boolean): string {
    const { correction } = verifyWrites(trajectory, supervisorText, this._config.language ?? 'en')
    const finalText = correction ? `${supervisorText}\n\n${correction}` : supervisorText
    if (finalText) this.messages.push(new AIMessage(finalText))
    const ts = Date.now()
    const runs: AgentRun[] = trajectoryToRuns(trajectory).map((r) => ({ ...r, messageId: turnId }))
    const timeline = trajectoryToTimeline(trajectory)
    const toolCalls = runs.flatMap((r) => r.toolCalls ?? []).sort((a, b) => a.seq - b.seq)
    if (this.store) {
      this.store.insertTurn(
        finalText ? { id: turnId, sessionId: this.id, agentId: 'supervisor', content: finalText, timestamp: ts, stopped, timeline } : null,
        this.id,
        runs,
      )
      this.store.touchSession(this.id, ts)
    }
    send({
      type: 'message:complete',
      sessionId: this.id,
      message: { id: turnId, role: 'assistant', content: finalText, agentId: 'supervisor', timestamp: ts, timeline, toolCalls, agentRuns: runs, ...(stopped ? { stopped: true } : {}) },
    })
    return finalText
  }

  /** Re-run the last turn: drop the trailing assistant reply (if any) and stream a fresh one. */
  async regenerate(send: SendFn): Promise<void> {
    if (this.running) return
    if (!this.requireApiKey(send)) return
    const tail = this.messages[this.messages.length - 1]
    if (tail instanceof AIMessage) {
      this.messages.pop()
      this.store?.deleteLastAssistantMessage(this.id)
    }
    // After dropping an assistant reply, the tail must be the user turn to redo.
    if (!(this.messages[this.messages.length - 1] instanceof HumanMessage)) return
    await this.runTurn(send)
  }

  cancel(): void {
    this.abortController?.abort()
  }

  destroy(): void {
    this.cancel()
  }
}
