import type { ServerMessage, SessionConfig, AgentRole, Message, AgentRun, FsEntry } from '@hip/protocol'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import type { SessionStore } from '../persistence/store.js'
import * as workspaceFs from './workspace-fs.js'
import * as workspaceGit from './workspace-git.js'
import { clip, stringify, trajectoryToRuns, trajectoryToTimeline, ReasoningTracker, type TraceRun, type TraceRecorder } from './tool-trace.js'
import { verifyWrites } from './verify.js'
import { IdleWatchdog } from './idle-watchdog.js'
import { getActiveModel, isOpenAICompatible, cheapModelFor } from '../config/providers.js'
import { resolveApiKey } from '../config/auth-file.js'
import { buildGraph, type GraphEmit, type GraphCtx } from './graph.js'
import { buildTools } from './tools.js'
import { buildSystemPrompt } from './system-prompt.js'
import { RealModelRunner, type ModelRunner } from './model-runner.js'
import { recursionLimit } from './loop-control.js'
import type { Summarizer } from './compaction.js'
import { PAUSE_QUESTION } from './doom-loop.js'

type SendFn = (msg: ServerMessage) => void

const TITLE_LEN = 40

/** A turn with no outbound activity for this long is treated as a stalled provider stream and aborted. */
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000

/** DEPRECATED — superseded by the global active model (config/providers.ts). buildModel no longer
 *  calls this; it remains only for the legacy DeepSeek thinking-toggle unit tests pending full removal.
 *  thinking === false → fast non-reasoning model; otherwise the reasoner. A caller-pinned config.model wins. */
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

/** Production title generator: one cheap completion. Not used when a model is injected (tests). */
function buildDefaultTitleGenerator(_config: SessionConfig): TitleGenerator {
  return async ({ firstUserMessage, firstReply }) => {
    const { providerID, modelID, baseURL } = getActiveModel()
    const model = new ChatOpenAI({
      model: modelID,
      apiKey: activeKey(providerID),
      configuration: { baseURL },
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

function activeKey(providerID: string): string {
  return resolveApiKey(providerID) || 'sk-missing'
}

function buildModel(_config: SessionConfig): ChatOpenAI {
  const { providerID, modelID, baseURL } = getActiveModel()
  return new ReasoningChatOpenAI({
    model: modelID,
    apiKey: activeKey(providerID),
    configuration: { baseURL },
  })
}

const NOOP_SUMMARIZER: Summarizer = { async summarize() { return '' } }

const SUMMARY_SYSTEM_PROMPT =
  '你是对话压缩器。把给定的较早对话片段压成一段简洁中文摘要，保留：任务目标、关键决策、约束、' +
  '已写入或修改的文件、近期工具结果与未决事项；丢弃：中间推理、被否方案、冗长输出。只输出摘要正文。'

/** Production summarizer: one cheap completion over the middle span. Not used in injected-model tests. */
class RealSummarizer implements Summarizer {
  async summarize(messages: BaseMessage[]): Promise<string> {
    const { providerID, modelID, baseURL } = getActiveModel()
    const model = new ChatOpenAI({ model: cheapModelFor(providerID, modelID), apiKey: activeKey(providerID), configuration: { baseURL }, maxTokens: 512, temperature: 0.2 })
    const transcript = messages.map((m) => `${m.getType()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n')
    const res = await model.invoke([new SystemMessage(SUMMARY_SYSTEM_PROMPT), new HumanMessage(transcript)])
    return typeof res.content === 'string' ? res.content : ''
  }
}

export class Session {
  private app!: ReturnType<typeof buildGraph>
  private readonly injectedRunner?: ModelRunner
  private _config: SessionConfig
  private readonly injectedModel?: BaseLanguageModel
  private readonly messages: BaseMessage[] = []
  private abortController: AbortController | null = null
  // Re-entrancy guard: a second send/regenerate while a turn is in flight is dropped (the WS layer dispatches fire-and-forget, so it does not serialize).
  private running = false
  private awaitingResume = false
  private paused: { messages: BaseMessage[]; steps: number } | null = null
  private readonly injectedSummarizer?: Summarizer
  private modelDirty = false
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
    runner?: ModelRunner,
    summarizer?: Summarizer,
  ) {
    this._config = config
    this.injectedModel = model
    this.injectedRunner = runner
    this.injectedSummarizer = summarizer
    this.usesEnvModel = !model && !runner
    // Inject a generator (tests), else build the real one only for the env-keyed
    // production model. Injected-model sessions get no generator → no LLM title.
    this.titleGenerator = titleGenerator ?? (this.usesEnvModel ? buildDefaultTitleGenerator(config) : undefined)
    this.buildAgent()
  }

  /** Current config (cwd may change via setCwd). */
  get config(): SessionConfig {
    return this._config
  }

  /** (Re)build the compiled agent-loop graph (reused across turns; per-turn state is passed via configurable.ctx). */
  private buildAgent(): void {
    this.app = buildGraph()
  }

  /** The ModelRunner for this turn: injected (tests) or a RealModelRunner over the built ChatOpenAI. */
  private modelRunner(): ModelRunner {
    if (this.injectedRunner) return this.injectedRunner
    const model = (this.injectedModel as ChatOpenAI | undefined) ?? buildModel(this._config)
    return new RealModelRunner(model)
  }

  /** The Summarizer for compaction: injected (tests), else a cheap-model summarizer for the env model,
   *  else a no-op (injected-model/runner sessions never hit the paid path). */
  private summarizer(): Summarizer {
    if (this.injectedSummarizer) return this.injectedSummarizer
    return this.usesEnvModel ? new RealSummarizer() : NOOP_SUMMARIZER
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

  /** Rebuild against the current global active model. NO-OP (returns false) while a turn is running;
   *  the next sendMessage rebuilds (see modelDirty). Injected-model sessions (tests) are unaffected. */
  applyActiveModel(): boolean {
    if (!this.usesEnvModel) return true
    if (this.running) { this.modelDirty = true; return false }
    this.buildAgent()
    return true
  }

  /** Set/clear per-conversation instructions and rebuild the agent. NO-OP (returns false) while a turn is running. */
  setSystemPrompt(systemPrompt: string | null): boolean {
    if (this.running) return false
    const next = systemPrompt?.trim() || undefined
    this._config = { ...this._config, systemPrompt: next }
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

  /** Worktree-vs-HEAD diff of the bound cwd subtree. Never throws. */
  async workspaceDiff(): Promise<workspaceGit.WorkspaceDiff> {
    if (!this._config.cwd) return { state: 'no_cwd' }
    return workspaceGit.collectWorkspaceDiff(this._config.cwd)
  }

  /** One-click `git init` + baseline commit in the bound cwd. */
  async workspaceGitInit(): Promise<{ ok: boolean; error?: string }> {
    if (!this._config.cwd) return { ok: false, error: 'no_workspace' }
    return workspaceGit.gitInit(this._config.cwd)
  }

  /** Emit INCOMPATIBLE_MODEL and return false when the active provider is not OpenAI-compatible.
   *  The renderer's catalog gate normally prevents selecting one, but a stale/hand-edited
   *  hip-providers.json can name e.g. `anthropic`; without this we'd build a ChatOpenAI against an
   *  incompatible endpoint and fail every turn with an opaque AGENT_ERROR. Runs before requireApiKey
   *  so the root cause (incompatibility) is surfaced even when the provider happens to have a key.
   *  Injected-model sessions (tests) are exempt — they drive arbitrary providers deliberately. */
  private requireCompatibleModel(send: SendFn): boolean {
    if (this.usesEnvModel) {
      const { providerID } = getActiveModel()
      if (!isOpenAICompatible(providerID)) {
        send({ type: 'error', sessionId: this.id, code: 'INCOMPATIBLE_MODEL', message: `Provider "${providerID}" is not OpenAI-compatible and can't be used here. Pick an OpenAI-compatible model in Settings.` })
        return false
      }
    }
    return true
  }

  /** Emit NO_API_KEY and return false when the env-keyed active provider has no key. */
  private requireApiKey(send: SendFn): boolean {
    if (this.usesEnvModel) {
      const { providerID } = getActiveModel()
      if (!resolveApiKey(providerID)) {
        send({ type: 'error', sessionId: this.id, code: 'NO_API_KEY', message: 'API key not configured. Set it in Settings.' })
        return false
      }
    }
    return true
  }

  async sendMessage(content: string, _send: SendFn, userMessageId?: string): Promise<void> {
    if (this.running || this.awaitingResume) return
    if (this.modelDirty) { this.buildAgent(); this.modelDirty = false }
    if (!this.requireCompatibleModel(_send)) return
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

  /** Continue a turn that paused for user input (Option Z): append the answer to the stashed rich
   *  message list and re-invoke as a fresh turn carrying the prior step count. No-op unless awaiting. */
  async resume(content: string, send: SendFn): Promise<void> {
    if (!this.awaitingResume || !this.paused || this.running) return
    const base = { messages: [...this.paused.messages, new HumanMessage(content)], steps: this.paused.steps }
    this.awaitingResume = false
    this.paused = null
    const ts = Date.now()
    if (this.store) {
      this.store.insertMessage({ id: `u-${ts}`, sessionId: this.id, role: 'user', agentId: null, content, timestamp: ts })
      this.store.touchSession(this.id, ts)
    }
    this.messages.push(new HumanMessage(content))
    await this.runTurn(send, base)
  }

  /** Stream one turn for the HumanMessage already at the tail of this.messages.
   *  Returns the supervisor text on clean completion, or '' on abort/error. */
  private async runTurn(rawSend: SendFn, base?: { messages: BaseMessage[]; steps: number }): Promise<string> {
    this.abortController = new AbortController()
    this.running = true
    let timedOut = false
    const watchdog = new IdleWatchdog(this.idleTimeoutMs, () => { timedOut = true; this.abortController?.abort() })
    const send: SendFn = (msg) => { watchdog.kick(); rawSend(msg) }

    const turnId = `asst-supervisor-${Date.now()}-${this.turnSeq++}`
    const trajectory = new Map<string, TraceRun>()
    let agentSeq = 0
    let stepSeq = 0
    const nextSeq = () => stepSeq++
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
        if (truncated || tc.truncated) tc.truncated = true
      },
    }
    const reasoning = new ReasoningTracker(nextSeq)
    const reasoningDelta = (agentId: string, role: AgentRole, delta: string) => {
      if (!delta) return
      const burstSeq = reasoning.push(agentId, delta)
      send({ type: 'reasoning:delta', sessionId: this.id, turnId, agentId, role, stepSeq: burstSeq, delta })
    }
    const closeReasoning = (agentId: string) => {
      const burst = reasoning.close(agentId)
      if (burst) { const r = trajectory.get(agentId); if (r) r.reasoningBursts.push(burst) }
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

    const cwd = this._config.cwd ?? process.cwd()
    const tools = buildTools(cwd)
    const system = buildSystemPrompt({ cwd, userInstructions: this._config.systemPrompt })
    const emit: GraphEmit = {
      token: (delta) => {
        if (!delta) return
        supervisorText += delta
        const r = trajectory.get('supervisor'); if (r) r.output += delta
        send({ type: 'token:stream', sessionId: this.id, turnId, agentId: 'supervisor', delta })
      },
      reasoning: (delta) => reasoningDelta('supervisor', 'supervisor', delta),
      toolStarted: (name, callId, input) => {
        closeReasoning('supervisor')
        const seq = nextSeq()
        const inClip = clip(stringify(input))
        recorder.start('supervisor', callId, name, inClip.text, seq, inClip.truncated)
        send({ type: 'tool:started', sessionId: this.id, turnId, agentId: 'supervisor', role: 'supervisor', callId, name, input: inClip.text, seq, ...(inClip.truncated ? { truncated: true } : {}) })
      },
      toolFinished: (callId, status, output, error) => {
        const outClip = output !== undefined ? clip(stringify(output)) : undefined
        recorder.finish('supervisor', callId, status, outClip?.text, error, outClip?.truncated ?? false)
        send({ type: 'tool:finished', sessionId: this.id, turnId, agentId: 'supervisor', callId, status, ...(outClip ? { output: outClip.text } : {}), ...(error ? { error } : {}), ...(outClip?.truncated ? { truncated: true } : {}) })
      },
    }
    const ctx: GraphCtx = { runner: this.modelRunner(), tools, emit, summarizer: this.summarizer() }

    try {
      const finalState = await this.app.invoke(
        { messages: [new SystemMessage(system), ...(base?.messages ?? this.messages)], steps: base?.steps ?? 0, recentSigs: [], nudgedSig: undefined, status: 'running' },
        { configurable: { ctx }, signal: this.abortController.signal, recursionLimit: recursionLimit() },
      )
      closeReasoning('supervisor')
      finishRemaining()
      if (finalState.status === 'awaiting_user') {
        // Stash the rich graph history (minus the leading system msg) so resume re-plans with full
        // context, finalize this turn as stopped, and ask the user. The finally below stops the
        // watchdog and clears `running`; `awaitingResume` makes the next user message a resume.
        this.paused = { messages: finalState.messages.slice(1), steps: finalState.steps }
        this.awaitingResume = true
        const stoppedText = this.finalizeAndPersist(send, turnId, supervisorText, trajectory, true)
        send({ type: 'agent:interrupt', sessionId: this.id, turnId, agentId: 'supervisor', question: finalState.pendingQuestion ?? PAUSE_QUESTION })
        return stoppedText
      }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      finishRemaining()
      if (isAbort && supervisorText) {
        const text = this.finalizeAndPersist(rawSend, turnId, supervisorText, trajectory, true)
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
    if (this.running || this.awaitingResume) return
    if (!this.requireCompatibleModel(send)) return
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
    if (this.awaitingResume) { this.awaitingResume = false; this.paused = null; return }
    this.abortController?.abort()
  }

  destroy(): void {
    this.cancel()
  }
}
