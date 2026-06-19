import { readFileSync } from 'node:fs'
import type { PluginsConfig } from '@hip/protocol'

/** Read the configured plugins from HIP_PLUGINS_PATH. Missing/corrupt file → { plugins: [] }. */
export function readPluginsConfig(): PluginsConfig {
  const file = process.env.HIP_PLUGINS_PATH?.trim()
  if (!file) return { plugins: [] }
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as PluginsConfig
    return { plugins: Array.isArray(cfg?.plugins) ? cfg.plugins : [] }
  } catch {
    return { plugins: [] }
  }
}
