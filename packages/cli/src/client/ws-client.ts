import WebSocket from 'ws'
import type { ClientMessage, ServerMessage } from '@hip/protocol'

export type MessageHandler = (msg: ServerMessage) => void

export class HipWsClient {
  private ws: WebSocket | null = null
  private readonly handlers = new Set<MessageHandler>()
  private openPromise: Promise<void> | null = null

  connect(
    port: number,
    token: string,
    opts?: { clientRole?: 'cli' | 'gui' | 'unknown' },
  ): Promise<void> {
    if (this.openPromise) return this.openPromise
    this.openPromise = new Promise<void>((resolve, reject) => {
      const role = opts?.clientRole ?? 'cli'
      const url = `ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}&client=${encodeURIComponent(role)}`
      const ws = new WebSocket(url)
      this.ws = ws
      let settled = false
      ws.on('open', () => {
        settled = true
        resolve()
      })
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
        if (!settled) {
          reject(Object.assign(err, { code: 'WS_DISCONNECT' }))
        }
      })
      ws.on('close', (code, reason) => {
        if (code === 1008) {
          // auth / origin — surface for attach failures
          if (!settled) {
            settled = true
            reject(
              Object.assign(new Error(reason.toString() || 'ws close 1008'), {
                code: 'WS_AUTH_FAILED',
              }),
            )
          }
          for (const h of this.handlers) {
            h({
              type: 'error',
              code: 'WS_AUTH_FAILED',
              message: reason.toString() || 'ws close 1008',
            })
          }
        } else if (!settled) {
          settled = true
          reject(Object.assign(new Error('ws closed before open'), { code: 'APP_NOT_RUNNING' }))
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
