import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { createServer } from 'net'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { SessionManager } from '../session/session-manager.js'

const ALLOWED_ORIGINS = new Set([
  'http://localhost:1420',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
])

export class WsServer {
  private readonly wss: WebSocketServer
  private readonly sessionManager: SessionManager

  constructor(private readonly port: number, private readonly token: string) {
    this.wss = new WebSocketServer({ port })
    this.sessionManager = new SessionManager()
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.on('listening', resolve)
      this.wss.on('connection', (ws, req) => this.handleConnection(ws, req))
    })
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    // Origin: allow native (no origin) or an allow-listed origin.
    const origin = req.headers.origin
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      ws.close(1008, 'origin not allowed')
      return
    }
    // Token: required, from the query string (?token=...).
    const url = new URL(req.url ?? '', 'ws://localhost')
    if (url.searchParams.get('token') !== this.token) {
      ws.close(1008, 'invalid token')
      return
    }

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
