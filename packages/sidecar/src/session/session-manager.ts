import type { ClientMessage, ServerMessage, SessionConfig } from '@hip/protocol'
import { Session } from './session.js'

type SendFn = (msg: ServerMessage) => void

export class SessionManager {
  private readonly sessions = new Map<string, Session>()

  handle(msg: ClientMessage, send: SendFn): void {
    switch (msg.type) {
      case 'session:create':
        this.createSession(msg.id, msg.config, send)
        break
      case 'session:destroy':
        this.destroySession(msg.sessionId)
        break
      case 'message:send':
        this.sessions.get(msg.sessionId)?.sendMessage(msg.content, send)
        break
      case 'message:cancel':
        this.sessions.get(msg.sessionId)?.cancel()
        break
    }
  }

  private createSession(id: string, config: SessionConfig, send: SendFn): void {
    const session = new Session(id, config)
    this.sessions.set(id, session)
    send({ type: 'session:created', sessionId: id })
  }

  private destroySession(id: string): void {
    this.sessions.get(id)?.destroy()
    this.sessions.delete(id)
  }
}
