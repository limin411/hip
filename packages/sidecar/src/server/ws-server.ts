import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { createServer } from 'net'
import { randomUUID } from 'node:crypto'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { parseClientMessage } from '@hip/protocol'
import { SessionManager } from '../session/session-manager.js'
import type { SessionStore } from '../persistence/store.js'
import { getActiveModel } from '../config/providers.js'
import { resolveApiKey } from '../config/auth-file.js'
import { logInfo, logDebug } from '../debug-logger.js'
import {
  ClientRegistry,
  multiClientEnabled,
  parseClientRole,
  type ClientConnection,
} from './client-registry.js'
import { createRoutedSend } from './message-route.js'

const ALLOWED_ORIGINS = new Set([
  'http://localhost:1420',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
])

/** Loopback only — never expose the agent WS on non-local interfaces. */
const BIND_HOST = '127.0.0.1'

export class WsServer {
  private readonly wss: WebSocketServer
  private readonly sessionManager: SessionManager
  private readonly registry = new ClientRegistry()
  private readonly multiClient: boolean

  constructor(private readonly port: number, private readonly token: string, store?: SessionStore) {
    this.wss = new WebSocketServer({ port, host: BIND_HOST })
    this.sessionManager = new SessionManager(store)
    this.multiClient = multiClientEnabled()
    // Wire IM gateway broadcast to the WS client registry
    this.sessionManager.setImBroadcast((msg) => this.registry.broadcast(msg))
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.on('listening', resolve)
      this.wss.on('connection', (ws, req) => this.handleConnection(ws, req))
    })
  }

  /** Exposed for tests. */
  getSessionManagerForTest(): SessionManager {
    return this.sessionManager
  }

  /** Stop background timers (trash retention). Call on sidecar shutdown. */
  dispose(): void {
    this.sessionManager.stopTrashRetentionHousekeeping()
  }

  private broadcastClientsChanged(): void {
    if (!this.multiClient) return
    const msg: ServerMessage = {
      type: 'clients:changed',
      clients: this.registry.listClients(),
    }
    this.registry.broadcast(msg)
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

    const role = parseClientRole(url.searchParams.get('client'))
    const connectionId = randomUUID()
    const conn: ClientConnection = {
      id: connectionId,
      role,
      socket: ws,
      send: () => {},
      connectedAt: Date.now(),
    }
    // Unicast send used for connect-only / legacy single-client path.
    conn.send = (msg) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(msg))
        } catch {
          /* ignore */
        }
      }
    }

    if (this.multiClient) {
      if (!this.registry.tryAdd(conn)) {
        logInfo('ws', 'client:rejected_limit', { connectionId, role })
        ws.close(1008, 'too many connections')
        return
      }
    }

    logInfo('ws', 'client:connected', {
      connectionId,
      role,
      multiClient: this.multiClient,
      clients: this.registry.size,
    })

    const hasApiKey = !!resolveApiKey(getActiveModel().providerID)
    const ready: ServerMessage = this.multiClient
      ? {
          type: 'ready',
          hasApiKey,
          multiClient: true,
          connectionId,
          clients: this.registry.listClients(),
        }
      : { type: 'ready', hasApiKey }
    conn.send(ready)

    if (this.multiClient) {
      // Notify others that registry changed (exclude connect-time self already has snapshot).
      this.broadcastClientsChanged()
    }

    const reply = this.multiClient ? createRoutedSend(this.registry, conn) : conn.send

    ws.on('message', (data) => {
      try {
        const raw: unknown = JSON.parse(data.toString())
        const msg = parseClientMessage(raw)
        if (!msg) {
          reply({ type: 'error', code: 'INVALID_MESSAGE', message: 'unknown or malformed client message' })
          return
        }
        logDebug('ws', 'msg:received', {
          type: msg.type,
          sessionId: 'sessionId' in msg ? (msg as { sessionId?: string }).sessionId : undefined,
          connectionId,
        })
        this.sessionManager.handle(msg as ClientMessage, reply, connectionId, role)
      } catch (err) {
        reply({ type: 'error', code: 'PARSE_ERROR', message: String(err) })
      }
    })

    ws.on('close', () => {
      logInfo('ws', 'client:closed', { connectionId, role, multiClient: this.multiClient })
      if (this.multiClient) {
        this.registry.remove(connectionId)
        this.sessionManager.cancelOwnedBy(connectionId)
        this.broadcastClientsChanged()
      } else {
        // Legacy single-client: any close cancels everything.
        this.sessionManager.cancelAllRunning()
      }
    })
    ws.on('error', (err) => console.error('[ws] client error', err))
  }

  static findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = createServer()
      srv.listen(0, BIND_HOST, () => {
        const addr = srv.address()
        if (!addr || typeof addr === 'string') return reject(new Error('no address'))
        srv.close(() => resolve(addr.port))
      })
      srv.on('error', reject)
    })
  }
}
