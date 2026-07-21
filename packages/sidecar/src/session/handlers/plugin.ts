import type { ClientMessage } from '@hip/protocol'
import type { SendFn, SessionLifecycleContext } from './types.js'

export const PLUGIN_MESSAGE_TYPES = new Set([
  'plugin:install:url',
  'plugin:install:github',
  'plugin:delete',
  'plugin:reload',
  'replay:session',
])

export function isPluginMessage(msg: ClientMessage): boolean {
  return PLUGIN_MESSAGE_TYPES.has(msg.type)
}

export type PluginInstallOptions = {
  sha?: string
  ref?: string
  subpath?: string
  marketSourceId?: string
  marketPluginName?: string
  runModelReview?: boolean
  startDisabled?: boolean
}

export type PluginHandlerContext = SessionLifecycleContext & {
  installPluginFromUrl(url: string, send: SendFn, opts?: PluginInstallOptions): Promise<void>
  replayTurn(sessionId: string, turnIndex: number, send: SendFn): Promise<void>
}

function reloadAllSessionPlugins(ctx: PluginHandlerContext): void {
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
}

/**
 * Plugin install/delete/reload and session replay — always async-capable.
 * Caller should only await after isPluginMessage (sync gate).
 */
export function handlePluginMessage(
  ctx: PluginHandlerContext,
  msg: ClientMessage,
  send: SendFn,
): void | Promise<void> {
  switch (msg.type) {
    case 'plugin:install:url':
      return ctx.installPluginFromUrl(msg.url, send, {
        sha: msg.sha,
        ref: msg.ref,
        subpath: msg.subpath,
        marketSourceId: msg.marketSourceId,
        marketPluginName: msg.marketPluginName,
        runModelReview: msg.runModelReview,
        startDisabled: msg.startDisabled,
      })
    case 'plugin:install:github':
      // Same pipeline as URL install (github URLs are validated inside installPluginFromUrl).
      return ctx.installPluginFromUrl(msg.url, send)
    case 'plugin:delete': {
      const pluginId = msg.pluginId
      if (!pluginId || typeof pluginId !== 'string') {
        send({ type: 'plugin:delete:result', pluginId: pluginId ?? '', ok: false, error: 'pluginId is required' })
        return
      }
      reloadAllSessionPlugins(ctx)
      send({ type: 'plugin:delete:result', pluginId, ok: true })
      return
    }
    case 'plugin:reload':
      reloadAllSessionPlugins(ctx)
      return
    case 'replay:session':
      return ctx.replayTurn(msg.sessionId, msg.turnIndex, send)
    default:
      return
  }
}
