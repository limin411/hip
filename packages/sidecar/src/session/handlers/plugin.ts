import type { ClientMessage } from '@hip/protocol'
import type { SendFn, SessionLifecycleContext } from './types.js'

export const PLUGIN_MESSAGE_TYPES = new Set([
  'plugin:install:url',
  'plugin:install:github',
  'plugin:delete',
  'replay:session',
])

export function isPluginMessage(msg: ClientMessage): boolean {
  return PLUGIN_MESSAGE_TYPES.has(msg.type)
}

export type PluginHandlerContext = SessionLifecycleContext & {
  installPluginFromUrl(url: string, send: SendFn): Promise<void>
  replayTurn(sessionId: string, turnIndex: number, send: SendFn): Promise<void>
}

/**
 * Plugin install/delete and session replay — always async-capable.
 * Caller should only await after isPluginMessage (sync gate).
 */
export function handlePluginMessage(
  ctx: PluginHandlerContext,
  msg: ClientMessage,
  send: SendFn,
): void | Promise<void> {
  switch (msg.type) {
    case 'plugin:install:url':
      return ctx.installPluginFromUrl(msg.url, send)
    case 'plugin:install:github':
      // Same pipeline as URL install (github URLs are validated inside installPluginFromUrl).
      return ctx.installPluginFromUrl(msg.url, send)
    case 'plugin:delete': {
      const pluginId = msg.pluginId
      if (!pluginId || typeof pluginId !== 'string') {
        send({ type: 'plugin:delete:result', pluginId: pluginId ?? '', ok: false, error: 'pluginId is required' })
        return
      }
      ctx.forEachSession((session) => {
        try {
          session.reloadPlugins()
        } catch (err) {
          console.warn(
            `[session-manager] failed to reload plugins for session ${session.id}:`,
            err instanceof Error ? err.message : String(err),
          )
        }
      })
      send({ type: 'plugin:delete:result', pluginId, ok: true })
      return
    }
    case 'replay:session':
      return ctx.replayTurn(msg.sessionId, msg.turnIndex, send)
    default:
      return
  }
}
