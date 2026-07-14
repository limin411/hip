import WebSocket from 'ws'
import type { ClientMessage, ServerMessage } from '@hip/protocol'

export type MessageHandler = (msg: ServerMessage) => void

export class HipWsClient {
  private ws: WebSocket | null = null
  private readonly handlers = new Set<MessageHandler>()
  private openPromise: Promise<void> | null = null

  connect(port: number, token: string): Promise<void> {
    if (this.openPromise) return this.openPromise
    this.openPromise = new Promise<void>((resolve, reject) => {
      const url = `ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`
      const ws = new WebSocket(url)
      this.ws = ws
      ws.on('open', () => resolve())
      ws.on('message', (data) => {
        let msg: ServerMessage
        try {
          msg = JSON.parse(data.toString()) as ServerMessage
        } catch {
          return
        }
        for (const h of this.handlers) h(msg)
      })
      ws.on('error', (err) => {
        reject(Object.assign(err, { code: 'WS_DISCONNECT' }))
      })
      ws.on('close', (code, reason) => {
        if (code === 1008) {
          // auth / origin — surface for attach failures
          for (const h of this.handlers) {
            h({
              type: 'error',
              code: 'WS_AUTH_FAILED',
              message: reason.toString() || 'ws close 1008',
            })
          }
        }
      })
    })
    return this.openPromise
  }

  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('ws not open')
    }
    this.ws.send(JSON.stringify(msg))
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  /** Inject a message (tests / fake WS). */
  emit(msg: ServerMessage): void {
    for (const h of this.handlers) h(msg)
  }

  close(): void {
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        /* ignore */
      }
      this.ws = null
    }
    this.openPromise = null
  }
}
