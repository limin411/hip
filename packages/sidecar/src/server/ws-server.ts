import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'net'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { SessionManager } from '../session/session-manager.js'

export class WsServer {
  private readonly wss: WebSocketServer
  private readonly sessionManager: SessionManager

  constructor(private readonly port: number) {
    this.wss = new WebSocketServer({ port })
    this.sessionManager = new SessionManager()
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.on('listening', resolve)
      this.wss.on('connection', (ws) => this.handleConnection(ws))
    })
  }

  private handleConnection(ws: WebSocket): void {
    const send = (msg: ServerMessage) => ws.send(JSON.stringify(msg))
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage
        this.sessionManager.handle(msg, send)
      } catch (err) {
        send({ type: 'error', code: 'PARSE_ERROR', message: String(err) })
      }
    })
    ws.on('error', (err) => console.error('[ws] client error', err))
  }

  static findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = createServer()
      srv.listen(0, () => {
        const addr = srv.address()
        if (!addr || typeof addr === 'string') return reject(new Error('no address'))
        srv.close(() => resolve(addr.port))
      })
      srv.on('error', reject)
    })
  }
}
