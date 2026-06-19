// packages/sidecar/src/session/plugins/parser.ts
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { AgentConfig, Hook, McpServerConfig, PluginManifest } from '@hip/protocol'

/** Error thrown by parsePluginManifest when the manifest is invalid. */
export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginManifestError'
  }
}

/**
 * Parse a plugin manifest at `<pluginDir>/.plugin/plugin.json` per the
 * Vercel open-plugin-spec.  Throws PluginManifestError on any validity
 * problem (missing file, invalid JSON, missing name/version, path traversal).
 *
 * Relative paths in `skills`, `mcpServers`, `agents` and `hooks` are resolved
 * to absolute paths rooted at `pluginDir`.  Inline object definitions are
 * left untouched.
 */
export function parsePluginManifest(pluginDir: string): PluginManifest {
  const manifestPath = join(pluginDir, '.plugin', 'plugin.json')
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (e) {
    throw new PluginManifestError(`Failed to read plugin manifest at ${manifestPath}: ${e}`)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PluginManifestError('Plugin manifest must be a JSON object')
  }

  const m = raw as Record<string, unknown>

  // -- required fields -------------------------------------------------------
  const name = m.name
  if (typeof name !== 'string' || name.length === 0) {
    throw new PluginManifestError('Plugin manifest requires a non-empty "name" field')
  }
  const version = m.version
  if (typeof version !== 'string' || version.length === 0) {
    throw new PluginManifestError('Plugin manifest requires a non-empty "version" field')
  }

  // -- optional fields with simple types -------------------------------------
  const id = typeof m.id === 'string' && m.id.length > 0 ? m.id : name
  const description = typeof m.description === 'string' ? m.description : undefined
  const license = typeof m.license === 'string' ? m.license : undefined

  // author
  let author: PluginManifest['author']
  if (typeof m.author === 'object' && m.author !== null && !Array.isArray(m.author)) {
    const a = m.author as Record<string, unknown>
    if (typeof a.name === 'string') {
      author = {
        name: a.name,
        email: typeof a.email === 'string' ? a.email : undefined,
        url: typeof a.url === 'string' ? a.url : undefined,
      }
    }
  }

  // keywords
  const keywords: string[] | undefined = Array.isArray(m.keywords)
    ? m.keywords.filter((k): k is string => typeof k === 'string')
    : undefined

  // -- resolved paths helper -------------------------------------------------

  /**
   * Resolve a single relative path against `pluginDir`.  Throws if the value
   * contains `..` (path-traversal attempt) or resolves outside `pluginDir`.
   */
  const resolveOne = (value: unknown): string => {
    if (typeof value !== 'string' || value.length === 0) {
      throw new PluginManifestError(`Expected a non-empty string path, got ${typeof value}`)
    }
    // Reject explicit ..
    if (value.includes('..')) {
      throw new PluginManifestError(`Path traversal rejected: "${value}" contains ".."`)
    }
    const absolute = resolve(pluginDir, value)
    const rel = relative(pluginDir, absolute)
    // If the relative path escapes, the first segment will be `..`
    if (rel.startsWith('..') || absolute === resolve(pluginDir, '.')) {
      throw new PluginManifestError(
        `Path traversal rejected: "${value}" resolves outside the plugin directory`,
      )
    }
    return absolute
  }

  /** Resolve a string or string[] to a string or string[]. */
  const resolveStringish = (
    value: unknown,
  ): string | string[] | undefined => {
    if (value === undefined) return undefined
    if (typeof value === 'string') return resolveOne(value)
    if (Array.isArray(value)) return value.map((v) => resolveOne(v))
    throw new PluginManifestError(`Expected string or string[], got ${typeof value}`)
  }

  // -- component fields ------------------------------------------------------

  const skills = resolveStringish(m.skills)

  // mcpServers: McpServerConfig[]  or  string (path to a JSON file)
  let mcpServers: McpServerConfig[] | string | undefined
  if (m.mcpServers !== undefined) {
    if (typeof m.mcpServers === 'string') {
      mcpServers = resolveOne(m.mcpServers)
    } else if (Array.isArray(m.mcpServers)) {
      mcpServers = m.mcpServers as McpServerConfig[]
    } else {
      throw new PluginManifestError(
        `mcpServers must be an array of configs or a string path, got ${typeof m.mcpServers}`,
      )
    }
  }

  // agents: AgentConfig[]  or  string (path)
  let agents: AgentConfig[] | string | undefined
  if (m.agents !== undefined) {
    if (typeof m.agents === 'string') {
      agents = resolveOne(m.agents)
    } else if (Array.isArray(m.agents)) {
      agents = m.agents as AgentConfig[]
    } else {
      throw new PluginManifestError(
        `agents must be an array of configs or a string path, got ${typeof m.agents}`,
      )
    }
  }

  // hooks: Hook[]  or  string (path)
  let hooks: Hook[] | string | undefined
  if (m.hooks !== undefined) {
    if (typeof m.hooks === 'string') {
      hooks = resolveOne(m.hooks)
    } else if (Array.isArray(m.hooks)) {
      hooks = m.hooks as Hook[]
    } else {
      throw new PluginManifestError(
        `hooks must be an array of configs or a string path, got ${typeof m.hooks}`,
      )
    }
  }

  return {
    id,
    name,
    version,
    description,
    author,
    license,
    keywords: keywords && keywords.length > 0 ? keywords : undefined,
    skills,
    mcpServers,
    agents,
    hooks,
  }
}
