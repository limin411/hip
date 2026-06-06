// src/domain/sessionService.ts
import type { ServerMessage, SessionConfig } from '@hip/protocol'
import type { Transport } from './transport'
import { MockTransport } from './mockTransport'
import { useDomainStore, DEFAULT_CONFIG } from './sessionStore'

let sessionSeq = 0

export class SessionService {
  private readonly transport: Transport

  constructor(transport: Transport) {
    this.transport = transport
    this.transport.onMessage((msg: ServerMessage) => this.receive(msg))
  }

  async connect(): Promise<void> {
    const store = useDomainStore.getState()
    store.setConnection('connecting')
    try {
      await this.transport.connect()
      store.setConnection('connected')
    } catch {
      store.setConnection('error')
    }
  }

  private receive(msg: ServerMessage): void {
    useDomainStore.getState().apply(msg)
  }

  createSession(config: SessionConfig = DEFAULT_CONFIG): string {
    const id = `s-new-${(sessionSeq += 1)}`
    useDomainStore.getState().createSession(id, config)
    this.transport.send({ type: 'session:create', id, config })
    return id
  }

  selectSession(id: string): void {
    useDomainStore.getState().selectSession(id)
  }

  deleteSession(id: string): void {
    useDomainStore.getState().deleteSession(id)
    this.transport.send({ type: 'session:destroy', sessionId: id })
  }

  sendMessage(content: string): void {
    const text = content.trim()
    if (!text) return
    const { activeSessionId, appendUserMessage } = useDomainStore.getState()
    if (!activeSessionId) return
    appendUserMessage(activeSessionId, text)
    this.transport.send({ type: 'message:send', sessionId: activeSessionId, content: text, role: 'user' })
  }

  cancel(): void {
    const { activeSessionId } = useDomainStore.getState()
    if (activeSessionId) this.transport.send({ type: 'message:cancel', sessionId: activeSessionId })
  }
}

/** App 单例：默认接 MockTransport。切 live = 改成 `new WsTransport()`。 */
export const sessionService = new SessionService(new MockTransport())
