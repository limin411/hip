// Pure helpers for the plugin_install tool, extracted from tools.ts so the tool body
// stays focused on orchestration and the helpers are independently testable.
import { existsSync, readdirSync, writeFileSync, mkdirSync, renameSync, rmSync, readFileSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import type { PluginManifest } from '@hip/protocol'
import { parsePluginManifest } from './plugins/parser.js'

/**
 * Validate a git clone URL for the plugin_install tool.
 * Rejects non-HTTPS schemes, embedded credentials, and dangerous URL types.
 * Returns null if valid, or an error string describing the rejection reason.
 */
export function validatePluginUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Invalid URL'
  }
  const scheme = parsed.protocol.replace(/:$/, '')
  if (parsed.protocol !== 'https:') {
    return `Only https:// URLs are permitted, got "${scheme}"`
  }
  // Reject embedded credentials in the URL (e.g. https://user:pass@host)
  if (parsed.username || parsed.password) {
    return 'URL must not contain embedded credentials'
  }
  return null
}

/**
 * Slugify a plugin name using the same logic as Rust's `slugify_plugin()`
 * in `src-tauri/src/plugins.rs`. Converts to lowercase, replaces non-alphanumeric
 * chars with dashes, collapses consecutive dashes, and strips trailing dashes.
 */
export function slugifyPlugin(name: string): string {
  let out = ''
  let prevDash = false
  for (const ch of name) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) {
      out += ch.toLowerCase()
      prevDash = false
    } else if (!prevDash && out.length > 0) {
      out += '-'
      prevDash = true
    }
  }
  while (out.endsWith('-')) {
    out = out.slice(0, -1)
  }
  return out || 'plugin'
}

/**
 * Extract the repository slug from a URL string.
 * Drops `.git`, trailing slashes, query/hash, and returns the last path segment.
 */
function repoSlugFromUrl(urlString: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(urlString)
  } catch {
    return undefined
  }
  const pathname = parsed.pathname.replace(/\/+$/, '').replace(/\.git$/, '')
  const lastSlash = pathname.lastIndexOf('/')
  const slug = lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname
  return slug || undefined
}

/**
 * Infer a plugin version from `stagingDir`.
 *
 * Reads `package.json` `version` field if present and valid; otherwise falls
 * back to `'0.0.0'`.
 */
export function inferPluginVersion(stagingDir: string): string {
  const pkgPath = join(stagingDir, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown }
      if (typeof pkg.version === 'string' && pkg.version.length > 0) {
        return pkg.version
      }
    } catch {
      /* ignore malformed package.json */
    }
  }
  return '0.0.0'
}

/**
 * Infer a human-readable plugin name from `stagingDir` and optional `sourceUrl`.
 *
 * Preference order:
 * 1. `package.json` `name` field in `stagingDir` (strip npm scope).
 * 2. Git remote origin URL from `stagingDir/.git/config`.
 * 3. `sourceUrl` repo slug.
 * 4. `basename(stagingDir)` fallback.
 *
 * The result is passed through `slugifyPlugin` to match manifest constraints.
 */
export function inferPluginName(stagingDir: string, sourceUrl?: string): string {
  const pkgPath = join(stagingDir, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: unknown }
      if (typeof pkg.name === 'string') {
        const scoped = pkg.name
        const lastSlash = scoped.lastIndexOf('/')
        const rawName = lastSlash >= 0 ? scoped.slice(lastSlash + 1) : scoped
        return slugifyPlugin(rawName)
      }
    } catch {
      /* ignore malformed package.json */
    }
  }

  const gitDir = join(stagingDir, '.git')
  if (existsSync(gitDir)) {
    try {
      const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
        cwd: stagingDir,
        timeout: 5_000,
        stdio: 'pipe',
      })
        .toString('utf8')
        .trim()
      const slug = repoSlugFromUrl(remote)
      if (slug) return slugifyPlugin(slug)
    } catch {
      /* ignore missing/invalid git config */
    }
  }

  if (sourceUrl) {
    const slug = repoSlugFromUrl(sourceUrl)
    if (slug) return slugifyPlugin(slug)
  }

  return slugifyPlugin(basename(stagingDir))
}

/**
 * Read optional Claude Code marketplace metadata from `.claude-plugin/plugin.json`.
 */
function readClaudePluginMeta(stagingDir: string): Record<string, unknown> | null {
  const p = join(stagingDir, '.claude-plugin', 'plugin.json')
  if (!existsSync(p)) return null
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
    return raw as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Auto-generate a minimal plugin.json manifest by scanning common plugin layouts
 * inside `stagingDir`. This is used when the cloned repo has no `.plugin/plugin.json`.
 *
 * Scanning rules:
 * - skills/<name>/SKILL.md → skills: ["./skills/<name>", ...]
 * - .mcp.json at root → mcpServers: "./.mcp.json"
 * - hip CJS hooks (hooks/hooks.cjs or hooks/index.cjs) only — Claude
 *   hooks/hooks.json is intentionally omitted (Phase A)
 * - agents/ (any files) → agents: "./agents.json"
 * - .claude-plugin/plugin.json supplies name/version/description when present
 */
export function generatePluginManifest(stagingDir: string, sourceUrl?: string): Record<string, unknown> {
  const claude = readClaudePluginMeta(stagingDir)

  const skills: string[] = []
  const skillsDir = join(stagingDir, 'skills')
  if (existsSync(skillsDir)) {
    try {
      for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md'))) {
          skills.push(`./skills/${entry.name}`)
        }
      }
    } catch {
      /* readdir may fail on permission — ignore and continue */
    }
  }

  let mcpServers: string | undefined
  if (existsSync(join(stagingDir, '.mcp.json'))) {
    mcpServers = './.mcp.json'
  }

  // Only reference hooks modules that actually exist and are hip-compatible CJS.
  let hooks: string | undefined
  const hooksCjs = join(stagingDir, 'hooks', 'hooks.cjs')
  const hooksIndexCjs = join(stagingDir, 'hooks', 'index.cjs')
  if (existsSync(hooksCjs)) {
    hooks = './hooks/hooks.cjs'
  } else if (existsSync(hooksIndexCjs)) {
    hooks = './hooks/index.cjs'
  } else if (existsSync(join(stagingDir, 'hooks', 'hooks.json'))) {
    console.warn(
      '[plugin-install] hooks/hooks.json looks like Claude Code format; ' +
        'omitting hooks from generated manifest (skills still install). ' +
        'code=hooks_deferred_claude_format',
    )
  }

  let agents: string | undefined
  const agentsDir = join(stagingDir, 'agents')
  if (existsSync(agentsDir)) {
    try {
      if (readdirSync(agentsDir).length > 0) {
        agents = './agents.json'
      }
    } catch {
      /* ignore */
    }
  }

  const nameFromClaude =
    typeof claude?.name === 'string' && claude.name.length > 0
      ? slugifyPlugin(claude.name)
      : undefined
  const versionFromClaude =
    typeof claude?.version === 'string' && claude.version.length > 0
      ? claude.version
      : undefined

  const generated: Record<string, unknown> = {
    name: nameFromClaude ?? inferPluginName(stagingDir, sourceUrl),
    version: versionFromClaude ?? inferPluginVersion(stagingDir),
  }
  if (typeof claude?.description === 'string') generated.description = claude.description
  if (typeof claude?.license === 'string') generated.license = claude.license
  if (Array.isArray(claude?.keywords)) {
    const kw = claude.keywords.filter((k): k is string => typeof k === 'string')
    if (kw.length > 0) generated.keywords = kw
  }
  if (claude?.author && typeof claude.author === 'object' && !Array.isArray(claude.author)) {
    generated.author = claude.author
  }
  if (skills.length > 0) generated.skills = skills
  if (mcpServers !== undefined) generated.mcpServers = mcpServers
  if (hooks !== undefined) generated.hooks = hooks
  if (agents !== undefined) generated.agents = agents
  return generated
}

/**
 * Resolve the final install slug for a plugin, handling collisions.
 *
 * 1. Slugify `name` → `base`.
 * 2. If `pluginsDir/<base>` does NOT exist → return `base`.
 * 3. If it DOES exist AND the path is in `existingPaths` → reject (already installed).
 * 4. If it DOES exist but NOT in `existingPaths` → append `-2`, `-3`, ... until
 *    the directory does not exist.
 *
 * Returns the resolved slug string. Throws if the plugin is already installed.
 */
export function resolveInstallSlug(
  name: string,
  pluginsDir: string,
  existingPaths: ReadonlySet<string>,
): string {
  const base = slugifyPlugin(name)
  const candidate = join(pluginsDir, base)
  if (!existsSync(candidate)) return base

  if (existingPaths.has(candidate)) {
    throw new Error(`Plugin is already installed (directory "${base}" exists and is registered)`)
  }

  // Directory collision with something not in hip-plugins.json — suffix it
  let n = 2
  while (true) {
    const suffix = `${base}-${n}`
    if (!existsSync(join(pluginsDir, suffix))) return suffix
    n += 1
  }
}

/** The directory staging lifecycle step. Separated so tests can skip git clone. */
export interface StagingResult {
  stagingDir: string
  /** True when the staging dir was created by this call (needs cleanup on error). */
  owned: boolean
}

/**
 * Create a staging directory and optionally clone a git repo into it.
 * When `providedStagingDir` is given (test seam), skips mkdir + git clone.
 */
export function prepareStaging(
  url: string,
  pluginsDir: string,
  providedStagingDir?: string,
): StagingResult {
  if (providedStagingDir) {
    return { stagingDir: providedStagingDir, owned: false }
  }
  const stagingDir = join(pluginsDir, `.staging-${randomUUID()}`)
  mkdirSync(stagingDir, { recursive: true })
  try {
    execFileSync('git', ['clone', '--depth', '1', url, stagingDir], {
      timeout: 60_000,
      stdio: 'pipe',
    })
    return { stagingDir, owned: true }
  } catch (err) {
    // Clean up the staging dir on clone failure
    try {
      rmSync(stagingDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    const msg = (err as Error).message
    if (msg.includes('ETIMEDOUT') || msg.toLowerCase().includes('timed out')) {
      throw new Error('git clone timed out after 60s')
    }
    throw new Error(`git clone failed: ${msg}`)
  }
}

/**
 * Read or generate the plugin manifest from `stagingDir`.
 * Returns the parsed PluginManifest. Throws on invalid manifest.
 */
export function readOrGenerateManifest(stagingDir: string, sourceUrl?: string): PluginManifest {
  const manifestDir = join(stagingDir, '.plugin')
  const manifestPath = join(manifestDir, 'plugin.json')

  if (existsSync(manifestPath)) {
    return parsePluginManifest(stagingDir)
  }

  // Auto-generate
  const generated = generatePluginManifest(stagingDir, sourceUrl)
  mkdirSync(manifestDir, { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(generated, null, 2), 'utf8')
  return parsePluginManifest(stagingDir)
}

/** Convenience: remove a directory tree, ignoring missing/errors. */
export function cleanupStagingDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* already gone or permission error — best-effort */
  }
}

/**
 * Count the entries in a JSON or CJS file referenced by a plugin manifest.
 * Returns the array length for a top-level array, or the length of the first
 * array-valued property for an object wrapper. Returns 0 on any failure.
 */
export function countFileEntries(filePath: string): number {
  try {
    const ext = extname(filePath).toLowerCase()
    if (ext === '.cjs' || ext === '.js') {
      const req = createRequire(import.meta.url)
      // Clear require cache so repeated test runs see fresh files.
      delete req.cache[req.resolve(filePath)]
      const mod = req(filePath)
      const arr = Array.isArray(mod) ? mod : mod.default
      return Array.isArray(arr) ? arr.length : 0
    }
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    if (Array.isArray(raw)) return raw.length
    if (raw && typeof raw === 'object') {
      for (const key of Object.keys(raw)) {
        const value = (raw as Record<string, unknown>)[key]
        if (Array.isArray(value)) return value.length
      }
    }
    return 0
  } catch {
    return 0
  }
}

/** Count the components declared in a parsed plugin manifest. */
export function countComponents(manifest: PluginManifest): { skills: number; mcpServers: number; agents: number; hooks: number } {
  const skills =
    manifest.skills === undefined
      ? 0
      : Array.isArray(manifest.skills)
        ? manifest.skills.length
        : 1

  const countOptional = (value: string | unknown[] | undefined): number => {
    if (value === undefined) return 0
    if (Array.isArray(value)) return value.length
    if (typeof value === 'string') return countFileEntries(value)
    return 0
  }

  return {
    skills,
    mcpServers: countOptional(manifest.mcpServers),
    agents: countOptional(manifest.agents),
    hooks: countOptional(manifest.hooks),
  }
}

/** The shape returned by the plugin_install tool on success. */
export interface PluginInstallSuccess {
  ok: true
  pluginId: string
  components: {
    skills: number
    mcpServers: number
    agents: number
    hooks: number
  }
}

/** The shape returned by the plugin_install tool on failure. */
export interface PluginInstallFailure {
  ok: false
  error: string
}

export type PluginInstallResult = PluginInstallSuccess | PluginInstallFailure
