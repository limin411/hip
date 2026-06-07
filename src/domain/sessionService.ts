// src/domain/sessionService.ts
import type { ServerMessage, SessionConfig } from '@hip/protocol'
import type { Transport } from './transport'
import { WsTransport } from './wsTransport'
import { useDomainStore, DEFAULT_CONFIG } from './sessionStore'

let sessionSeq = 0

export class SessionService {
  private readonly transport: Transport
  private readonly unsubscribe: () => void
  private readonly unsubStatus: () => void

  constructor(transport: Transport) {
    this.transport = transport
    this.unsubscribe = this.transport.onMessage((msg: ServerMessage) => this.receive(msg))
    this.unsubStatus = this.transport.onStatus((s) => useDomainStore.getState().setConnection(s))
  }

  dispose(): void {
    this.unsubscribe()
    this.unsubStatus()
  }

  async connect(): Promise<void> {
    try {
      await this.transport.connect()
    } catch (e) {
      console.error('[SessionService] connect failed', e)
      useDomainStore.getState().setConnection('error')
    }
  }

  reconnect(): void {
    void this.connect()
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
    let { activeSessionId } = useDomainStore.getState()
    if (!activeSessionId) {
      activeSessionId = this.createSession()
    }
    useDomainStore.getState().appendUserMessage(activeSessionId, text)
    this.transport.send({ type: 'message:send', sessionId: activeSessionId, content: text, role: 'user' })
  }

  cancel(): void {
    const { activeSessionId } = useDomainStore.getState()
    if (activeSessionId) this.transport.send({ type: 'message:cancel', sessionId: activeSessionId })
  }
}

/**
 * App 单例：接 live 后端（WsTransport）。
 * 若要在无 Tauri 环境下使用 mock，临时改为 MockTransport 即可。
 */
export const sessionService = new SessionService(new WsTransport())
