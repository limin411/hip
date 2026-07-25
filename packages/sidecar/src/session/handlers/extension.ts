import { basename } from 'node:path'
import type { ClientMessage } from '@hip/protocol'
import { isPluginEnabled, readPluginsConfig } from '../../config/plugins.js'
import { inspectExtensions } from '../extensions/load.js'
import { preflightPluginEnable, summarizeRegistryConflicts } from '../extensions/preflight.js'
import type { SendFn } from './types.js'

export const EXTENSION_MESSAGE_TYPES = new Set([
  'extension:inspect',
  'extension:preflight',
])

export function isExtensionMessage(msg: ClientMessage): boolean {
  return EXTENSION_MESSAGE_TYPES.has(msg.type)
}

function resolvePluginDir(pluginId?: string, pluginDir?: string): string | null {
  if (pluginDir?.trim()) return pluginDir.trim()
  if (!pluginId?.trim()) return null
  const id = pluginId.trim()
  try {
    const cfg = readPluginsConfig()
    for (const dir of cfg.plugins) {
      if (basename(dir) === id || dir.endsWith(`/${id}`) || dir.endsWith(`\\${id}`)) {
        return dir
      }
      // Also match manifest id via path basename (install slug)
      if (isPluginEnabled(dir, cfg) || true) {
        if (basename(dir) === id) return dir
      }
    }
    // Fall back: any registered path whose basename equals id
    for (const dir of cfg.plugins) {
      if (basename(dir) === id) return dir
    }
  } catch {
    return null
  }
  return null
}

export function handleExtensionMessage(msg: ClientMessage, send: SendFn): void {
  switch (msg.type) {
    case 'extension:inspect': {
      const requestId = msg.requestId
      const cwd = (msg.cwd?.trim() || process.cwd())
      try {
        const snapshot = inspectExtensions(cwd)
        const { notable } = summarizeRegistryConflicts(cwd)
        send({
          type: 'extension:inspect:result',
          requestId,
          ok: true,
          snapshot,
          notableConflicts: notable,
        })
      } catch (e) {
        send({
          type: 'extension:inspect:result',
          requestId,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        })
      }
      return
    }
    case 'extension:preflight': {
      const requestId = msg.requestId
      const cwd = (msg.cwd?.trim() || process.cwd())
      const dir = resolvePluginDir(msg.pluginId, msg.pluginDir)
      if (!dir) {
        send({
          type: 'extension:preflight:result',
          requestId,
          ok: false,
          error: 'pluginDir or resolvable pluginId is required',
        })
        return
      }
      try {
        const preflight = preflightPluginEnable(cwd, dir)
        send({
          type: 'extension:preflight:result',
          requestId,
          ok: true,
          preflight: {
            pluginId: preflight.pluginId,
            pluginDir: preflight.pluginDir,
            skillConflicts: preflight.skillConflicts,
            mcpIdConflicts: preflight.mcpIdConflicts,
            capabilityConflicts: preflight.capabilityConflicts,
            recommendations: preflight.recommendations,
            hasConflicts: preflight.hasConflicts,
          },
        })
      } catch (e) {
        send({
          type: 'extension:preflight:result',
          requestId,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        })
      }
      return
    }
    default:
      return
  }
}
