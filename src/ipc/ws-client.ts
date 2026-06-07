import type { ClientMessage, ServerMessage } from '@hip/protocol'
import type { ConnectionStatus } from '@/domain/transport'

type MessageHandler = (msg: ServerMessage) => void
type StatusHandler = (s: ConnectionStatus) => void
type Resolver = () => Promise<{ port: number; token: string }>

const MAX_BACKOFF_MS = 10_000

class WsClient {
  private ws: WebSocket | null = null
  private resolver: Resolver | null = null
  private readonly handlers = new Set<MessageHandler>()
  private readonly statusHandlers = new Set<StatusHandler>()
  private backoff = 500
  private stopped = false

  /** Begin the connect/reconnect loop. Resolves on the FIRST successful open. */
  start(resolver: Resolver): Promise<void> {
    this.resolver = resolver
    this.stopped = false
    return new Promise<void>((resolveOnce) => {
      let settled = false
      const onceConnected = () => { if (!settled) { settled = true; resolveOnce() } }
      this.connectLoop(onceConnected)
    })
  }

  private async connectLoop(onConnected: () => void): Promise<void> {
    if (this.stopped) return
    this.setStatus('connecting')
    try {
      const { port, token } = await this.resolver!()
      const ws = new WebSocket(`ws://localhost:${port}/?token=${encodeURIComponent(token)}`)
      this.ws = ws
      ws.onopen = () => { this.backoff = 500; this.setStatus('connected'); onConnected() }
      ws.onmessage = (e) => {
        let msg: ServerMessage
        try { msg = JSON.parse(e.data as string) as ServerMessage } catch { return }
        this.handlers.forEach((h) => h(msg))
      }
      ws.onerror = () => this.setStatus('error')
      ws.onclose = () => { this.ws = null; this.setStatus('disconnected'); this.scheduleReconnect(onConnected) }
    } catch {
      this.setStatus('error')
      this.scheduleReconnect(onConnected)
    }
  }

  private scheduleReconnect(onConnected: () => void): void {
    if (this.stopped) return
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
    setTimeout(() => this.connectLoop(onConnected), delay)
  }

  send(msg: ClientMessage): void { this.ws?.send(JSON.stringify(msg)) }
  onMessage(h: MessageHandler): () => void { this.handlers.add(h); return () => this.handlers.delete(h) }
  onStatus(h: StatusHandler): () => void { this.statusHandlers.add(h); return () => this.statusHandlers.delete(h) }
  private setStatus(s: ConnectionStatus): void { this.statusHandlers.forEach((h) => h(s)) }

  disconnect(): void { this.stopped = true; this.ws?.close(); this.ws = null }
}

export const wsClient = new WsClient()
