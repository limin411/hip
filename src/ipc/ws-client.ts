import type { ClientMessage, ServerMessage } from '@hip/protocol'

type MessageHandler = (msg: ServerMessage) => void

class WsClient {
  private ws: WebSocket | null = null
  private readonly handlers = new Set<MessageHandler>()

  connect(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${port}`)
      this.ws.onopen = () => resolve()
      this.ws.onerror = (e) => reject(e)
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as ServerMessage
        this.handlers.forEach((h) => h(msg))
      }
    })
  }

  send(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg))
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }
}

export const wsClient = new WsClient()
