import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One installed plugin tracked by the store. */
export interface InstalledPlugin {
  slug: string
  name: string
  dir: string
  skills: string[]
  mcpServers: string[]
  agents: string[]
  trust: string[]
  installedAt: number
}

/** On-disk shape of ~/.hip/config/plugins.json.
 *  The `plugins` array preserves backward compat with readPluginsConfig().
 *  `entries` holds the richer metadata used by the PluginManager. */
interface PluginsFile {
  plugins: string[]
  entries?: InstalledPlugin[]
}

function configPath(): string {
  return process.env.HIP_PLUGINS_PATH?.trim()
    || join(homedir(), '.hip', 'config', 'plugins.json')
}

function readConfig(): PluginsFile {
  const file = configPath()
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const plugins = Array.isArray(raw?.plugins) ? raw.plugins.filter((e: unknown) => typeof e === 'string') : []
    const entries = Array.isArray(raw?.entries) ? raw.entries : []
    return { plugins, entries }
  } catch {
    return { plugins: [], entries: [] }
  }
}

function writeConfig(config: PluginsFile): void {
  const file = configPath()
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
}

/**
 * Persistent store for installed plugins, backed by ~/.hip/config/plugins.json.
 * Extends the existing `{ plugins: string[] }` format with a richer `entries` field.
 */
export class PluginStore {
  private configPath: string

  constructor(customPath?: string) {
    this.configPath = customPath ?? configPath()
  }

  /** Read the on-disk config with the configured (or default) path. */
  private read(): PluginsFile {
    try {
      const raw = JSON.parse(readFileSync(this.configPath, 'utf8'))
      const plugins = Array.isArray(raw?.plugins) ? raw.plugins.filter((e: unknown) => typeof e === 'string') : []
      const entries = Array.isArray(raw?.entries) ? raw.entries : []
      return { plugins, entries }
    } catch {
      return { plugins: [], entries: [] }
    }
  }

  private write(config: PluginsFile): void {
    const dir = dirname(this.configPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8')
  }

  /** List all installed plugins with metadata. */
  list(): InstalledPlugin[] {
    return this.read().entries ?? []
  }

  /** Register a newly installed plugin. Writes both the `plugins` array (path) and `entries` (metadata). */
  add(entry: InstalledPlugin): void {
    const config = this.read()
    if (!config.plugins.includes(entry.dir)) {
      config.plugins.push(entry.dir)
    }
    const existing = config.entries?.findIndex((e) => e.slug === entry.slug)
    if (existing !== undefined && existing >= 0) {
      config.entries![existing] = entry
    } else {
      if (!config.entries) config.entries = []
      config.entries.push(entry)
    }
    this.write(config)
  }

  /** Remove a plugin by slug. Returns true if the plugin was found and removed. */
  remove(slug: string): boolean {
    const config = this.read()
    const entryIdx = config.entries?.findIndex((e) => e.slug === slug) ?? -1
    if (entryIdx < 0) return false
    const dir = config.entries![entryIdx].dir
    config.entries!.splice(entryIdx, 1)
    config.plugins = config.plugins.filter((p) => p !== dir)
    this.write(config)
    return true
  }

  /** Check whether a plugin slug is already registered. */
  has(slug: string): boolean {
    return (this.read().entries ?? []).some((e) => e.slug === slug)
  }
}
