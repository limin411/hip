import type { ServerMessage, SessionConfig, AgentRole, Message, AgentRun } from '@hip/protocol'
import { createDeepAgent } from 'deepagents'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import { SUBAGENTS, SUPERVISOR_PROMPT, roleForName } from './agents.js'
import type { SessionStore } from '../persistence/store.js'

type SendFn = (msg: ServerMessage) => void

const DEFAULT_MODEL = 'deepseek-chat'
const TITLE_LEN = 40

function deriveTitle(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > TITLE_LEN ? oneLine.slice(0, TITLE_LEN) + '…' : oneLine || '新对话'
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
  private readonly agent: ReturnType<typeof createDeepAgent>
  private readonly messages: BaseMessage[] = []
  private abortController: AbortController | null = null
  private readonly usesEnvModel: boolean

  constructor(
    readonly id: string,
    readonly config: SessionConfig,
    model?: BaseLanguageModel,
    private readonly store?: SessionStore,
  ) {
    this.usesEnvModel = !model
    this.agent = createDeepAgent({
      model: model ?? buildModel(config),
      systemPrompt: config.systemPrompt ?? SUPERVISOR_PROMPT,
      subagents: SUBAGENTS as unknown as NonNullable<Parameters<typeof createDeepAgent>[0]>['subagents'],
    })
  }

  /** Seed prior conversation so the agent resumes with full context. */
  hydrate(messages: Message[]): void {
    for (const m of messages) {
      this.messages.push(m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content))
    }
  }

  async sendMessage(content: string, _send: SendFn, userMessageId?: string): Promise<void> {
    if (this.usesEnvModel && !process.env.DEEPSEEK_API_KEY?.trim()) {
      _send({
        type: 'error',
        sessionId: this.id,
        code: 'NO_API_KEY',
        message: 'DeepSeek API key not configured. Set it in Settings.',
      })
      return
    }

    // Persist the user message + bump/derive session metadata before running.
    const userTs = Date.now()
    if (this.store) {
      const seq = this.store.insertMessage({ id: userMessageId ?? `u-${userTs}`, sessionId: this.id, role: 'user', agentId: null, content, timestamp: userTs })
      this.store.touchSession(this.id, userTs)
      if (seq === 1) this.store.updateTitle(this.id, deriveTitle(content))
    }

    this.messages.push(new HumanMessage(content))
    this.abortController = new AbortController()

    // Trajectory: per-agent accumulated output + timings, in start order.
    type Run = { role: AgentRole; output: string; startedAt: number; finishedAt: number | null; seq: number }
    const trajectory = new Map<string, Run>()
    let agentSeq = 0

    const started = new Set<string>()
    const ensureStarted = (agentId: string, role: AgentRole) => {
      if (started.has(agentId)) return
      started.add(agentId)
      trajectory.set(agentId, { role, output: '', startedAt: Date.now(), finishedAt: null, seq: agentSeq++ })
      _send({ type: 'agent:started', sessionId: this.id, agentId, role })
    }
    const finishRemaining = () => {
      for (const id of started) {
        const r = trajectory.get(id); if (r) r.finishedAt = Date.now()
        _send({ type: 'agent:finished', sessionId: this.id, agentId: id })
      }
      started.clear()
    }

    let supervisorText = ''
    // The supervisor always runs; announce it up front so its card appears even
    // if it delegates without emitting any top-level text of its own.
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
            _send({ type: 'token:stream', sessionId: this.id, agentId: 'supervisor', delta })
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
              _send({ type: 'token:stream', sessionId: this.id, agentId, delta })
            }
          }
          if (started.delete(agentId)) {
            const r = trajectory.get(agentId); if (r) r.finishedAt = Date.now()
            _send({ type: 'agent:finished', sessionId: this.id, agentId })
          }
        }
      }

      await Promise.all([pumpSupervisor(), pumpSubagents()])
      finishRemaining()
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      finishRemaining()
      _send({
        type: 'error',
        sessionId: this.id,
        code: isAbort ? 'CANCELLED' : 'AGENT_ERROR',
        message: isAbort
          ? 'User cancelled the request'
          : err instanceof Error
            ? err.message
            : String(err),
      })
      return
    }

    // Don't append an empty assistant turn — some providers reject an empty
    // assistant message on the next request, corrupting multi-turn history.
    if (supervisorText) this.messages.push(new AIMessage(supervisorText))

    const ts = Date.now()
    const assistantId = `asst-supervisor-${ts}`
    // Trajectory is keyed by agentId — build AgentRun[] directly from its entries.
    const runs: AgentRun[] = [...trajectory.entries()].map(([agentId, r]) => ({
      agentId, role: r.role, output: r.output, startedAt: r.startedAt, finishedAt: r.finishedAt, seq: r.seq,
    }))
    // Persist the turn (assistant message only when non-empty, matching LangChain history).
    if (this.store) {
      this.store.insertTurn(
        supervisorText ? { id: assistantId, sessionId: this.id, agentId: 'supervisor', content: supervisorText, timestamp: ts } : null,
        this.id,
        runs,
      )
      this.store.touchSession(this.id, ts)
    }

    _send({
      type: 'message:complete',
      sessionId: this.id,
      message: {
        id: assistantId,
        role: 'assistant',
        content: supervisorText,
        agentId: 'supervisor',
        timestamp: ts,
      },
    })
  }

  cancel(): void {
    this.abortController?.abort()
  }

  destroy(): void {
    this.cancel()
  }
}
