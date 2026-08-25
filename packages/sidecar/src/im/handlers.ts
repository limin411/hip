/**
 * IM message handlers — dispatch im:* ClientMessages from the WS protocol.
 *
 * Registered alongside session/plugin/memory handlers in session-manager.
 */

import type {
  ClientMessage,
  ServerMessage,
  ImConnectorRecord,
  ImConnectorPublic,
  ImParkedEntry,
} from '@hip/protocol'
import type { SendFn } from '../session/handlers/types.js'
import { ImConnectorStore } from './store.js'

export const IM_MESSAGE_TYPES = new Set([
  'im:config:list',
  'im:config:upsert',
  'im:config:delete',
  'im:test',
  'im:parked:list',
  'im:parked:resolve',
])

export function isImMessage(msg: ClientMessage): boolean {
  return IM_MESSAGE_TYPES.has(msg.type)
}

export interface ImHandlerContext {
  store: ImConnectorStore
  /** Broadcast to all connected clients. */
  broadcast: (msg: ServerMessage) => void
  /** Send test message via adapter (optional, wired by gateway). */
  sendTest?: (connectorId: string) => Promise<boolean>
  /** Resolve parked entry by id. */
  resolveParked?: (connectorId: string, entryId: string, action: 'allow' | 'deny') => void
  /** Called after a connector is upserted. Use to auto-start the adapter. */
  onUpsert?: (connector: import('@hip/protocol').ImConnectorPublic) => void
}

export function handleImMessage(
  ctx: ImHandlerContext,
  msg: ClientMessage,
  send: SendFn,
): void {
  switch (msg.type) {
    case 'im:config:list': {
      send({
        type: 'im:config:list:result',
        connectors: ctx.store.listPublic(),
      })
      break
    }

    case 'im:config:upsert': {
      const pub = ctx.store.upsert(msg.connector)
      send({ type: 'im:config:upsert:result', connector: pub })
      // Trigger auto-connect for the adapter
      ctx.onUpsert?.(pub)
      break
    }

    case 'im:config:delete': {
      const ok = ctx.store.remove(msg.connectorId)
      send({ type: 'im:config:delete:result', connectorId: msg.connectorId, ok })
      break
    }

    case 'im:test': {
      void (async () => {
        let ok = false
        let error: string | undefined
        try {
          if (ctx.sendTest) {
            ok = await ctx.sendTest(msg.connectorId)
          } else {
            error = 'Test handler not available'
          }
        } catch (err) {
          error = err instanceof Error ? err.message : String(err)
        }
        send({ type: 'im:test:result', connectorId: msg.connectorId, ok, error })
      })()
      break
    }

    case 'im:parked:list': {
      const connector = ctx.store.get(msg.connectorId)
      send({
        type: 'im:parked:list:result',
        connectorId: msg.connectorId,
        entries: connector?.parked ?? [],
      })
      break
    }

    case 'im:parked:resolve': {
      if (ctx.resolveParked) {
        ctx.resolveParked(msg.connectorId, msg.entryId, msg.action)
      }
      send({
        type: 'im:parked:resolve:result',
        connectorId: msg.connectorId,
        entryId: msg.entryId,
        ok: true,
      })
      break
    }
  }
}
