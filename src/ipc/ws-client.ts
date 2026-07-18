import type { ClientMessage, ServerMessage } from '@hip/protocol'
import type { ConnectionStatus } from '@/domain/transport'

type MessageHandler = (msg: ServerMessage) => void
type StatusHandler = (s: ConnectionStatus) => void
type Resolver = () => Promise<{ port: number; token: string }>

const MAX_BACKOFF_MS = 10_000
const MAX_QUEUE = 100

class WsClient {
  private ws: WebSocket | null = null
  private resolver: Resolver | null = null
  private readonly handlers = new Set<MessageHandler>()
  private readonly statusHandlers = new Set<StatusHandler>()
  // Messages sent before the socket is OPEN are buffered and flushed on connect,
  // so actions taken during the (cold-start) connecting window aren't silently lost.
  private queue: ClientMessage[] = []
  private backoff = 500
  private stopped = false
  // Each start()/disconnect() bumps the epoch; a stale reconnect loop whose epoch
  // no longer matches stops itself, so we never run two loops or leak sockets.
  private epoch = 0

  /**
   * Begin the connect/reconnect loop. Resolves on the FIRST successful open and
   * then stays pending (failures surface via onStatus, not a rejection).
   * Calling start() again (e.g. the manual retry button) supersedes any prior loop.
   */
  start(resolver: Resolver): Promise<void> {
    this.resolver = resolver
    this.stopped = false
    const epoch = ++this.epoch
    this.closeSocket()
    return new Promise<void>((resolveOnce) => {
      let settled = false
      const onceConnected = () => {
        if (!settled) {
          settled = true
          resolveOnce()
        }
      }
      this.connectLoop(onceConnected, epoch)
    })
  }

  private closeSocket(): void {
    if (this.ws) {
      // Detach handlers first so the stale socket can't schedule a reconnect.
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.close()
      this.ws = null
    }
  }

  private async connectLoop(onConnected: () => void, epoch: number): Promise<void> {
    if (this.stopped || epoch !== this.epoch) return
    this.setStatus('connecting')
    try {
      const { port, token } = await this.resolver!()
      if (this.stopped || epoch !== this.epoch) return
      const ws = new WebSocket(
        `ws://localhost:${port}/?token=${encodeURIComponent(token)}&client=gui`,
      )
      this.ws = ws
      ws.onopen = () => {
        this.backoff = 500
        this.setStatus('connected')
        this.flushQueue()
        onConnected()
      }
      ws.onmessage = (e) => {
        let msg: ServerMessage
        try {
          msg = JSON.parse(e.data as string) as ServerMessage
        } catch {
          return
        }
        this.handlers.forEach((h) => h(msg))
      }
      ws.onerror = () => this.setStatus('error')
      ws.onclose = () => {
        this.ws = null
        this.setStatus('disconnected')
        this.scheduleReconnect(onConnected, epoch)
      }
    } catch {
      this.setStatus('error')
      this.scheduleReconnect(onConnected, epoch)
    }
  }

  private scheduleReconnect(onConnected: () => void, epoch: number): void {
    if (this.stopped || epoch !== this.epoch) return
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
    setTimeout(() => this.connectLoop(onConnected, epoch), delay)
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else if (this.queue.length < MAX_QUEUE) {
      this.queue.push(msg)
    }
  }

  /** Flush buffered messages once the socket is open (FIFO). */
  private flushQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const pending = this.queue
    this.queue = []
    for (const m of pending) this.ws.send(JSON.stringify(m))
  }

  onMessage(h: MessageHandler): () => void {
    this.handlers.add(h)
    return () => this.handlers.delete(h)
  }

  onStatus(h: StatusHandler): () => void {
    this.statusHandlers.add(h)
    return () => this.statusHandlers.delete(h)
  }

  private setStatus(s: ConnectionStatus): void {
    this.statusHandlers.forEach((h) => h(s))
  }

  disconnect(): void {
    this.stopped = true
    this.epoch++
    this.closeSocket()
  }
}

export const wsClient = new WsClient()
