import { readFileSync } from 'node:fs'
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
    return { plugins }
  } catch {
    return { plugins: [] }
  }
}
