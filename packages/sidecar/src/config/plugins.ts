import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { PluginsConfig } from '@hip/protocol'

/** Read the plugin registry from HIP_PLUGINS_PATH. Missing/corrupt file → { plugins: [] }.
 *  Non-string entries are filtered out with a console.warn. */
export function readPluginsConfig(): PluginsConfig {
  const file = process.env.HIP_PLUGINS_PATH?.trim()
  if (!file) return { plugins: [] }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const arr = raw?.plugins
    if (!Array.isArray(arr)) return { plugins: [] }
    const plugins: string[] = []
    for (const entry of arr) {
      if (typeof entry === 'string') {
        plugins.push(entry)
      } else {
        console.warn(`Skipping non-string plugin entry (${typeof entry}):`, entry)
      }
    }
    const enabled = parseEnabledMap(raw?.enabled)
    return enabled ? { plugins, enabled } : { plugins }
  } catch {
    return { plugins: [] }
  }
}

function parseEnabledMap(raw: unknown): Record<string, boolean> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean' && k.length > 0) out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** True when the plugin path should be loaded into a session (default on). */
export function isPluginEnabled(pluginDir: string, config: PluginsConfig): boolean {
  const id = basename(pluginDir)
  if (!id) return false
  if (config.enabled?.[id] === false) return false
  return true
}
