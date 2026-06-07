import type { ClientMessage, ServerMessage, SessionConfig } from '@hip/protocol'
import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import { Session } from './session.js'
import type { SessionStore } from '../persistence/store.js'

type SendFn = (msg: ServerMessage) => void
type ModelFactory = (config: SessionConfig) => BaseLanguageModel | undefined

export class SessionManager {
  private readonly sessions = new Map<string, Session>()

  // modelFactory defaults to undefined → Session builds the real env-keyed model.
  constructor(
    private readonly store?: SessionStore,
    private readonly modelFactory: ModelFactory = () => undefined,
  ) {}

  handle(msg: ClientMessage, send: SendFn): void {
    // Fire-and-forget, but never let a rejection (e.g. a rehydrate failure) become
    // an unhandled promise rejection — surface it to the client instead.
    this.handleAsync(msg, send).catch((err) => {
      console.error('[session-manager] handler error', err)
      const sessionId = 'sessionId' in msg ? (msg as { sessionId?: string }).sessionId : undefined
      send({ type: 'error', sessionId, code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) })
    })
  }

  async handleAsync(msg: ClientMessage, send: SendFn): Promise<void> {
    switch (msg.type) {
      case 'session:create':
        this.createSession(msg.id, msg.config, send)
        break
      case 'session:destroy':
        this.destroySession(msg.sessionId)
        break
      case 'message:send':
        await this.ensureSession(msg.sessionId).sendMessage(msg.content, send, msg.id)
        break
      case 'message:cancel':
        this.sessions.get(msg.sessionId)?.cancel()
        break
      case 'session:list':
        send({ type: 'session:list:result', sessions: this.store?.listSessions() ?? [] })
        break
      case 'session:load':
        send({ type: 'session:loaded', sessionId: msg.sessionId,
          messages: this.store?.loadMessages(msg.sessionId) ?? [],
          agentRuns: this.store?.loadAgentRuns(msg.sessionId) ?? [] })
        break
      case 'session:search':
        send({ type: 'session:search:result', query: msg.query, hits: this.store?.search(msg.query) ?? [] })
        break
      case 'session:delete':
        this.store?.deleteSession(msg.sessionId)
        this.sessions.delete(msg.sessionId)
        send({ type: 'session:deleted', sessionId: msg.sessionId })
        break
    }
  }

  private createSession(id: string, config: SessionConfig, send: SendFn): void {
    const now = Date.now()
    this.store?.insertSession({ id, title: '新对话', config: JSON.stringify(config), createdAt: now, updatedAt: now })
    this.sessions.set(id, new Session(id, config, this.modelFactory(config), this.store))
    send({ type: 'session:created', sessionId: id })
  }

  /** Get the in-memory session, or rebuild it from the DB (lazy resume). */
  private ensureSession(id: string): Session {
    const existing = this.sessions.get(id)
    if (existing) return existing
    const row = this.store?.getSession(id)
    const config: SessionConfig = row ? JSON.parse(row.config) : { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }
    const session = new Session(id, config, this.modelFactory(config), this.store)
    if (this.store) session.hydrate(this.store.loadMessages(id))
    this.sessions.set(id, session)
    return session
  }

  private destroySession(id: string): void {
    this.sessions.get(id)?.destroy()
    this.sessions.delete(id)
  }
}
