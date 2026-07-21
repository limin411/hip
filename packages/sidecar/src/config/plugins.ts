import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { PluginsConfig } from '@hip/protocol'

/**
 * Coerce one `plugins[]` entry to an absolute directory path string.
 * Accepts string, `{ dir }`, `{ path }`, or `{ root }` (legacy object shapes).
 * Returns null when the entry cannot be recovered.
 */
export function coercePluginEntry(entry: unknown): string | null {
  if (typeof entry === 'string') {
    const t = entry.trim()
    return t.length > 0 ? t : null
  }
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const o = entry as Record<string, unknown>
    for (const k of ['dir', 'path', 'root'] as const) {
      const v = o[k]
      if (typeof v === 'string' && v.trim().length > 0) return v.trim()
    }
  }
  return null
}

/** Read the plugin registry from HIP_PLUGINS_PATH. Missing/corrupt file → { plugins: [] }.
 *  Object entries with dir/path/root are coerced; unrecoverable entries are warned and skipped. */
export function readPluginsConfig(): PluginsConfig {
  const file = process.env.HIP_PLUGINS_PATH?.trim()
  if (!file) return { plugins: [] }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const arr = raw?.plugins
    if (!Array.isArray(arr)) return { plugins: [] }
    const plugins: string[] = []
    for (const entry of arr) {
      const path = coercePluginEntry(entry)
      if (path) {
        plugins.push(path)
      } else {
        console.warn(
          `[plugins] Skipping unrecoverable plugin registry entry (${typeof entry}):`,
          entry,
        )
      }
    }
    const enabled = parseEnabledMap(raw?.enabled)
    return enabled ? { plugins, enabled } : { plugins }
  } catch {
    return { plugins: [] }
  }
}

/**
 * Normalize on-disk hip-plugins.json to string[] paths (preserves enabled/entries).
 * Returns true when the file was rewritten. No-op when path missing or already clean.
 */
export function normalizePluginsConfigFile(filePath: string): boolean {
  if (!filePath || !existsSync(filePath)) return false
  let raw: Record<string, unknown>
  try {
    const body = readFileSync(filePath, 'utf8')
    if (!body.trim()) return false
    const parsed = JSON.parse(body) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false
    raw = parsed as Record<string, unknown>
  } catch {
    return false
  }
  const arr = raw.plugins
  if (!Array.isArray(arr)) return false

  let needsRewrite = false
  const plugins: string[] = []
  for (const entry of arr) {
    if (typeof entry !== 'string') needsRewrite = true
    const path = coercePluginEntry(entry)
    if (path) plugins.push(path)
    else needsRewrite = true
  }

  if (!needsRewrite) return false

  const out: Record<string, unknown> = {
    plugins,
  }
  if (Array.isArray(raw.entries)) out.entries = raw.entries
  if (raw.enabled && typeof raw.enabled === 'object' && !Array.isArray(raw.enabled)) {
    out.enabled = raw.enabled
  }
  writeFileSync(filePath, JSON.stringify(out, null, 2) + '\n', 'utf8')
  console.warn(`[plugins] Normalized registry at ${filePath} (${plugins.length} path(s))`)
  return true
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
