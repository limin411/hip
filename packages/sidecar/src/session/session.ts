import type { ServerMessage, SessionConfig, AgentRole, Message, AgentRun, FsEntry } from '@hip/protocol'
import { createDeepAgent, FilesystemBackend } from 'deepagents'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import { SUBAGENTS, SUPERVISOR_PROMPT, roleForName } from './agents.js'
import type { SessionStore } from '../persistence/store.js'
import * as workspaceFs from './workspace-fs.js'

type SendFn = (msg: ServerMessage) => void

const DEFAULT_MODEL = 'deepseek-chat'
const TITLE_LEN = 40

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

type Run = { role: AgentRole; output: string; startedAt: number; finishedAt: number | null; seq: number }

const TITLE_SYSTEM_PROMPT =
  'You generate a very short title (at most 6 words, or about 16 Chinese characters) for a chat conversation. ' +
  'Use the same language as the user. Reply with ONLY the title — no quotes, no trailing punctuation.'

/** Production title generator: one cheap DeepSeek completion. Not used when a model is injected (tests). */
function buildDefaultTitleGenerator(config: SessionConfig): TitleGenerator {
  return async ({ firstUserMessage, firstReply }) => {
    const model = new ChatOpenAI({
      model: config.model || DEFAULT_MODEL,
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

function buildModel(config: SessionConfig): ChatOpenAI {
  return new ChatOpenAI({
    model: config.model || DEFAULT_MODEL,
    apiKey: process.env.DEEPSEEK_API_KEY || 'sk-missing',
    configuration: {
      baseURL: 'https://api.deepseek.com/v1',
    },
  })
}

export class Session {
  private agent!: ReturnType<typeof createDeepAgent>
  private _config: SessionConfig
  private readonly injectedModel?: BaseLanguageModel
  private readonly messages: BaseMessage[] = []
  private abortController: AbortController | null = null
  // Re-entrancy guard: a second send/regenerate while a turn is in flight is dropped (the WS layer dispatches fire-and-forget, so it does not serialize).
  private running = false
  private readonly usesEnvModel: boolean
  private readonly titleGenerator?: TitleGenerator

  constructor(
    readonly id: string,
    config: SessionConfig,
    model?: BaseLanguageModel,
    private readonly store?: SessionStore,
    titleGenerator?: TitleGenerator,
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
    this.agent = createDeepAgent({
      model,
      systemPrompt: this._config.systemPrompt ?? SUPERVISOR_PROMPT,
      subagents: SUBAGENTS as unknown as NonNullable<Parameters<typeof createDeepAgent>[0]>['subagents'],
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
  private async runTurn(send: SendFn): Promise<string> {
    this.abortController = new AbortController()
    this.running = true

    const trajectory = new Map<string, Run>()
    let agentSeq = 0
    const started = new Set<string>()
    const ensureStarted = (agentId: string, role: AgentRole) => {
      if (started.has(agentId)) return
      started.add(agentId)
      trajectory.set(agentId, { role, output: '', startedAt: Date.now(), finishedAt: null, seq: agentSeq++ })
      send({ type: 'agent:started', sessionId: this.id, agentId, role })
    }
    const finishRemaining = () => {
      for (const id of started) {
        const r = trajectory.get(id); if (r) r.finishedAt = Date.now()
        send({ type: 'agent:finished', sessionId: this.id, agentId: id })
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
      const pumpSupervisor = async () => {
        for await (const msg of run.messages) {
          for await (const delta of msg.text) {
            if (!delta) continue
            supervisorText += delta
            const r = trajectory.get('supervisor'); if (r) r.output += delta
            send({ type: 'token:stream', sessionId: this.id, agentId: 'supervisor', delta })
          }
        }
      }
      const pumpSubagents = async () => {
        for await (const sub of run.subagents) {
          const agentId = sub.name
          ensureStarted(agentId, roleForName(sub.name))
          for await (const msg of sub.messages) {
            for await (const delta of msg.text) {
              if (!delta) continue
              const r = trajectory.get(agentId); if (r) r.output += delta
              send({ type: 'token:stream', sessionId: this.id, agentId, delta })
            }
          }
          if (started.delete(agentId)) {
            const r = trajectory.get(agentId); if (r) r.finishedAt = Date.now()
            send({ type: 'agent:finished', sessionId: this.id, agentId })
          }
        }
      }
      await Promise.all([pumpSupervisor(), pumpSubagents()])
      finishRemaining()
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      finishRemaining()
      if (isAbort && supervisorText) {
        // Keep the partial: finalize + persist with stopped=true (also enters next-turn context).
        this.finalizeAndPersist(send, supervisorText, trajectory, true)
      } else {
        send({
          type: 'error',
          sessionId: this.id,
          code: isAbort ? 'CANCELLED' : 'AGENT_ERROR',
          message: isAbort ? 'User cancelled the request' : err instanceof Error ? err.message : String(err),
        })
      }
      return ''
    } finally {
      this.running = false
      this.abortController = null
    }

    this.finalizeAndPersist(send, supervisorText, trajectory, false)
    return supervisorText
  }

  /** Push the assistant message into context, persist the turn, and emit message:complete. */
  private finalizeAndPersist(send: SendFn, supervisorText: string, trajectory: Map<string, Run>, stopped: boolean): void {
    if (supervisorText) this.messages.push(new AIMessage(supervisorText))
    const ts = Date.now()
    const assistantId = `asst-supervisor-${ts}`
    const runs: AgentRun[] = [...trajectory.entries()].map(([agentId, r]) => ({
      agentId, role: r.role, output: r.output, startedAt: r.startedAt, finishedAt: r.finishedAt, seq: r.seq,
    }))
    if (this.store) {
      this.store.insertTurn(
        supervisorText ? { id: assistantId, sessionId: this.id, agentId: 'supervisor', content: supervisorText, timestamp: ts, stopped } : null,
        this.id,
        runs,
      )
      this.store.touchSession(this.id, ts)
    }
    send({
      type: 'message:complete',
      sessionId: this.id,
      message: { id: assistantId, role: 'assistant', content: supervisorText, agentId: 'supervisor', timestamp: ts, ...(stopped ? { stopped: true } : {}) },
    })
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
