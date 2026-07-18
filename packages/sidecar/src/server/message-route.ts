import type { ServerMessage } from '@hip/protocol'
import type { ClientConnection, ClientRegistry } from './client-registry.js'

export type MessageRouteClass = 'unicast' | 'broadcast' | 'connect-only'

/**
 * Authority for multi-client delivery (design Appendix B).
 * Pattern rules preferred over dual hand-maintained lists.
 */
export function classify(msg: ServerMessage): MessageRouteClass {
  const t = msg.type

  if (t === 'ready') return 'connect-only'

  // RPC results: anything ending in :result
  if (t.endsWith(':result')) return 'unicast'

  // Installer progress is requester-only
  if (t === 'plugin:install:progress') return 'unicast'

  // session:loaded is a response to session:load
  if (t === 'session:loaded') return 'unicast'

  // memory:config is reply to get/set config
  if (t === 'memory:config') return 'unicast'

  // Errors: session-scoped → broadcast; bare RPC errors → unicast
  if (t === 'error') {
    if ('sessionId' in msg && msg.sessionId) return 'broadcast'
    return 'unicast'
  }

  // Everything else (lifecycle, streams, HITL, global mirrors) → broadcast
  return 'broadcast'
}

export function routeServerMessage(
  registry: ClientRegistry,
  origin: ClientConnection,
  msg: ServerMessage,
): void {
  switch (classify(msg)) {
    case 'unicast':
    case 'connect-only':
      registry.unicast(origin, msg)
      break
    case 'broadcast':
      registry.broadcast(msg)
      break
  }
}

/** Build a SendFn that classifies every emission from a request/turn path. */
export function createRoutedSend(
  registry: ClientRegistry,
  origin: ClientConnection,
): (msg: ServerMessage) => void {
  return (msg) => routeServerMessage(registry, origin, msg)
}
