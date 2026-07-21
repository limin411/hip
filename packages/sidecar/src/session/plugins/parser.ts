// packages/sidecar/src/session/plugins/parser.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { AgentConfig, Hook, McpServerConfig, PluginManifest } from '@hip/protocol'

/** Error thrown by parsePluginManifest when the manifest is invalid. */
export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginManifestError'
  }
}

/** Non-fatal parse notes (e.g. skipped Claude-style hooks). */
export type PluginManifestDiagnostic = {
  code: string
  message: string
}

export type ParsePluginManifestOptions = {
  /** Collect non-fatal diagnostics instead of only console.warn. */
  diagnostics?: PluginManifestDiagnostic[]
}

/**
 * Parse a plugin manifest at `<pluginDir>/.plugin/plugin.json` per the
 * Vercel open-plugin-spec.  Throws PluginManifestError on hard validity
 * problems (missing file, invalid JSON, missing name/version, path traversal).
 *
 * Soft-fail (no throw):
 * - `hooks` as a Claude-style event object → ignored (hooks_unsupported_format)
 * - bare skill ids → retry under `skills/<id>` when present
 * - missing `skills` → scan each skills/<id>/SKILL.md
 *
 * Relative paths in `skills`, `mcpServers`, `agents` and `hooks` are resolved
 * to absolute paths rooted at `pluginDir`.  Inline object definitions are
 * left untouched.
 */
export function parsePluginManifest(
  pluginDir: string,
  options?: ParsePluginManifestOptions,
): PluginManifest {
  const diagnostics = options?.diagnostics
  const note = (code: string, message: string) => {
    if (diagnostics) {
      diagnostics.push({ code, message })
    } else {
      console.warn(`[plugin:${pluginDir}] ${code}: ${message}`)
    }
  }

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

  /** Resolve a skill path; if bare id missing, try skills/<id>. */
  const resolveSkillPath = (value: unknown): string => {
    if (typeof value !== 'string' || value.length === 0) {
      throw new PluginManifestError(`Expected a non-empty string path, got ${typeof value}`)
    }
    if (value.includes('..')) {
      throw new PluginManifestError(`Path traversal rejected: "${value}" contains ".."`)
    }
    const direct = resolveOne(value)
    if (existsSync(direct)) return direct
    // Bare id / missing skills/ prefix (common Claude Code style)
    if (!value.includes('/') && !value.includes('\\')) {
      const underSkills = resolveOne(join('skills', value))
      if (existsSync(underSkills)) {
        note(
          'skills_path_rewritten',
          `Skill "${value}" not at plugin root; resolved to skills/${value}`,
        )
        return underSkills
      }
    }
    return direct
  }

  const scanSkillsDir = (): string[] | undefined => {
    const skillsRoot = join(pluginDir, 'skills')
    if (!existsSync(skillsRoot)) return undefined
    try {
      const found: string[] = []
      for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && existsSync(join(skillsRoot, entry.name, 'SKILL.md'))) {
          found.push(resolveOne(join('skills', entry.name)))
        }
      }
      return found.length > 0 ? found : undefined
    } catch {
      return undefined
    }
  }

  // -- component fields ------------------------------------------------------

  let skills: string | string[] | undefined
  if (m.skills === undefined) {
    skills = scanSkillsDir()
    if (skills) {
      note('skills_scanned', `Manifest omitted skills; scanned ${skills.length} under skills/`)
    }
  } else if (typeof m.skills === 'string') {
    skills = resolveSkillPath(m.skills)
  } else if (Array.isArray(m.skills)) {
    skills = m.skills.map((v) => resolveSkillPath(v))
  } else {
    throw new PluginManifestError(`Expected string or string[], got ${typeof m.skills}`)
  }

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

  // hooks: Hook[]  or  string (path). Object (Claude Code event map) → soft-skip.
  let hooks: Hook[] | string | undefined
  if (m.hooks !== undefined) {
    if (typeof m.hooks === 'string') {
      hooks = resolveOne(m.hooks)
    } else if (Array.isArray(m.hooks)) {
      hooks = m.hooks as Hook[]
    } else if (typeof m.hooks === 'object' && m.hooks !== null) {
      note(
        'hooks_unsupported_format',
        'hooks is an object (Claude Code event map); ignored — hip requires a CJS module path or Hook[]',
      )
      hooks = undefined
    } else {
      note(
        'hooks_unsupported_format',
        `hooks must be an array of configs or a string path, got ${typeof m.hooks}; ignored`,
      )
      hooks = undefined
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
