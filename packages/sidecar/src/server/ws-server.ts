import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { createServer } from 'net'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { SessionManager } from '../session/session-manager.js'
import type { SessionStore } from '../persistence/store.js'
import { getActiveModel } from '../config/providers.js'
import { resolveApiKey } from '../config/auth-file.js'
import { logInfo, logDebug } from '../debug-logger.js'

const ALLOWED_ORIGINS = new Set([
  'http://localhost:1420',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
])

export class WsServer {
  private readonly wss: WebSocketServer
  private readonly sessionManager: SessionManager

  constructor(private readonly port: number, private readonly token: string, store?: SessionStore) {
    this.wss = new WebSocketServer({ port })
    this.sessionManager = new SessionManager(store)
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

    logInfo('ws', 'client:connected')

    const send = (msg: ServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
    }
    // Tell the client whether this sidecar has a usable API key, so the UI can
    // surface "no key configured" without waiting for a failed send.
    send({ type: 'ready', hasApiKey: !!resolveApiKey(getActiveModel().providerID) })
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage
        logDebug('ws', 'msg:received', { type: (msg as any).type, sessionId: (msg as any).sessionId })
        this.sessionManager.handle(msg, send)
      } catch (err) {
        send({ type: 'error', code: 'PARSE_ERROR', message: String(err) })
      }
    })
    ws.on('close', () => this.sessionManager.cancelAllRunning())
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
