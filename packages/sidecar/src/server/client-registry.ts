import type { WebSocket } from 'ws'
import type { ServerMessage } from '@hip/protocol'
import type { SendFn } from '../session/handlers/types.js'

export type ClientRole = 'gui' | 'cli' | 'unknown'

export interface ClientConnection {
  id: string
  role: ClientRole
  socket: WebSocket
  send: SendFn
  connectedAt: number
}

export const MAX_WS_CONNECTIONS = 16

/** Soft limit + registry for multi-client WS. */
export class ClientRegistry {
  private readonly clients = new Map<string, ClientConnection>()

  get size(): number {
    return this.clients.size
  }

  get(id: string): ClientConnection | undefined {
    return this.clients.get(id)
  }

  values(): IterableIterator<ClientConnection> {
    return this.clients.values()
  }

  listClients(): Array<{ id: string; role: ClientRole }> {
    return [...this.clients.values()].map((c) => ({ id: c.id, role: c.role }))
  }

  hasGui(): boolean {
    for (const c of this.clients.values()) {
      if (c.role === 'gui') return true
    }
    return false
  }

  /** Returns false if soft limit exceeded (caller should close). */
  tryAdd(conn: ClientConnection): boolean {
    if (this.clients.size >= MAX_WS_CONNECTIONS) return false
    this.clients.set(conn.id, conn)
    return true
  }

  remove(id: string): void {
    this.clients.delete(id)
  }

  unicast(conn: ClientConnection, msg: ServerMessage): void {
    if (conn.socket.readyState === conn.socket.OPEN) {
      try {
        conn.socket.send(JSON.stringify(msg))
      } catch {
        /* ignore broken pipe */
      }
    }
  }

  broadcast(msg: ServerMessage): void {
    for (const c of this.clients.values()) {
      this.unicast(c, msg)
    }
  }

  createSend(conn: ClientConnection): SendFn {
    return (msg) => this.unicast(conn, msg)
  }
}

export function parseClientRole(raw: string | null): ClientRole {
  if (raw === 'gui' || raw === 'cli') return raw
  return 'unknown'
}

export function multiClientEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  // Default ON. Kill-switch: HIP_WS_MULTI_CLIENT=0 restores legacy cancel-all.
  const v = env.HIP_WS_MULTI_CLIENT?.trim()
  if (v === '0' || v === 'false' || v === 'off') return false
  return true
}
