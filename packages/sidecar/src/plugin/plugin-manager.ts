import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import type { PluginStore, InstalledPlugin } from './plugin-store.js'

// ─── types ────────────────────────────────────────────────────────────────────

export interface InstallFromGitHubResult {
  slug: string
  name: string
  skills: string[]
  mcpServers: string[]
  agents: string[]
  trust: string[]
}

export interface PluginManagerOptions {
  /** Override the fetch function for tests. */
  fetch?: typeof fetch
  /** Override the download+extract step for tests. Receives the download URL and target dir. */
  extract?: (tarballUrl: string, targetDir: string) => Promise<void>
}

// ─── URL parsing ──────────────────────────────────────────────────────────────

interface ParsedGitHubUrl {
  owner: string
  repo: string
  slug: string
}

/**
 * Parse a GitHub URL and extract owner/repo.
 * Supports:
 *   https://github.com/<owner>/<repo>
 *   https://github.com/<owner>/<repo>.git
 *   https://github.com/<owner>/<repo>/tree/<branch>
 */
function parseGitHubUrl(url: string): ParsedGitHubUrl {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid URL: ${url}`)
  }
  if (parsed.hostname !== 'github.com') {
    throw new Error(`Not a GitHub URL: ${url}. Expected hostname "github.com"`)
  }
  const parts = parsed.pathname.replace(/\.git$/, '').split('/').filter(Boolean)
  if (parts.length < 2) {
    throw new Error(`Invalid GitHub URL: ${url}. Expected path /owner/repo`)
  }
  const owner = parts[0]
  const repo = parts[1]
  const slug = repo.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!slug) throw new Error(`Could not derive slug from repo name: ${repo}`)
  return { owner, repo, slug }
}

// ─── default download + extract ───────────────────────────────────────────────

/** Resolve the plugins directory: HIP_PLUGINS_DIR env var or ~/.hip/plugins. */
function resolvePluginsDir(): string {
  return process.env.HIP_PLUGINS_DIR?.trim() || join(homedir(), '.hip', 'plugins')
}

/**
 * Download a tarball from GitHub and extract it to `targetDir`.
 * Uses the codeload.github.com endpoint (no auth required for public repos).
 */
async function defaultExtract(tarballUrl: string, targetDir: string): Promise<void> {
  const response = await fetch(tarballUrl, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`GitHub download failed: HTTP ${response.status} ${response.statusText}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  const tmpFile = join(resolvePluginsDir(), `.tmp-${randomUUID()}.tar.gz`)
  try {
    writeFileSync(tmpFile, buffer)
    mkdirSync(targetDir, { recursive: true })
    execFileSync('tar', ['-xzf', tmpFile, '-C', targetDir, '--strip-components=1'], {
      stdio: 'pipe',
      timeout: 30_000,
    })
  } catch (err) {
    // Clean up target dir on extraction failure
    try { rmSync(targetDir, { recursive: true, force: true }) } catch { /* ignore */ }
    throw new Error(`Failed to extract plugin tarball: ${(err as Error).message}`)
  } finally {
    try { rmSync(tmpFile) } catch { /* ignore */ }
  }
}

// ─── manifest reading ─────────────────────────────────────────────────────────

interface RawPluginManifest {
  name?: unknown
  version?: unknown
  skills?: unknown
  mcpServers?: unknown
  agents?: unknown
  hooks?: unknown
}

/** Try to read a plugin manifest from standard locations in the extracted directory. */
function readPluginManifest(pluginDir: string): RawPluginManifest {
  const locations = [
    join(pluginDir, '.plugin', 'plugin.json'),
    join(pluginDir, 'plugin.json'),
  ]
  for (const loc of locations) {
    if (existsSync(loc)) {
      try {
        const raw = JSON.parse(readFileSync(loc, 'utf8'))
        if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
          return raw as RawPluginManifest
        }
      } catch {
        throw new Error(`Invalid JSON in manifest file: ${loc}`)
      }
      break
    }
  }
  throw new Error(`No plugin.json found in ${pluginDir} (.plugin/plugin.json or plugin.json)`)
}

// ─── component extraction ─────────────────────────────────────────────────────

/** Extract skill IDs from the manifest. Skills can be a string path or string[] of paths. */
function extractSkillIds(manifest: RawPluginManifest): string[] {
  const skills = manifest.skills
  if (skills === undefined) return []
  if (typeof skills === 'string') return [basename(skills)]
  if (Array.isArray(skills)) {
    return skills.filter((s): s is string => typeof s === 'string').map((s) => basename(s))
  }
  return []
}

/** Read IDs from a JSON-value config (inline array or file reference). */
function extractIds(raw: unknown, pluginDir: string, arrayKey?: string): string[] {
  if (raw === undefined) return []
  if (typeof raw === 'string') {
    const filePath = join(pluginDir, raw)
    if (!existsSync(filePath)) return []
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8'))
      const arr = Array.isArray(data) ? data : (data as Record<string, unknown>)?.[arrayKey ?? '']
      if (!Array.isArray(arr)) return []
      return arr.filter((e: unknown) => typeof (e as Record<string, unknown>)?.id === 'string').map((e: Record<string, unknown>) => e.id as string)
    } catch { return [] }
  }
  if (Array.isArray(raw)) {
    return raw.filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null).map((e) => String(e.id ?? '')).filter(Boolean)
  }
  return []
}

// ─── trust derivation ─────────────────────────────────────────────────────────

/**
 * Derive the trust surface from a parsed manifest.
 * - skills → read_files (skills can read file contents from the project)
 * - mcpServers → network_access (MCP servers connect to external services)
 * - agents → run_scripts (agents execute as external processes)
 * - hooks → write_files (hooks can modify tool behavior, indirectly writing)
 */
function deriveTrust(manifest: RawPluginManifest): string[] {
  const trust: string[] = []
  if (manifest.skills !== undefined) trust.push('read_files')
  if (manifest.mcpServers !== undefined) trust.push('network_access')
  if (manifest.agents !== undefined) trust.push('run_scripts')
  if (manifest.hooks !== undefined) trust.push('write_files')
  return trust
}

// ─── PluginManager ────────────────────────────────────────────────────────────

/**
 * Manages plugin installation from GitHub repositories.
 *
 * Downloads a plugin tarball, extracts it to ~/.hip/plugins/<slug>/,
 * reads the plugin manifest, registers it with the PluginStore, and returns
 * a summary of what the plugin provides.
 */
export class PluginManager {
  private readonly fetchFn: typeof fetch
  private readonly extractFn: (tarballUrl: string, targetDir: string) => Promise<void>
  readonly pluginsDir: string

  constructor(
    private store: PluginStore,
    pluginsDir?: string,
    opts?: PluginManagerOptions,
  ) {
    this.pluginsDir = pluginsDir ?? resolvePluginsDir()
    this.fetchFn = opts?.fetch ?? fetch
    this.extractFn = opts?.extract ?? defaultExtract
  }

  /**
   * Install a plugin from a GitHub repository URL.
   *
   * 1. Parses the URL → owner/repo
   * 2. Downloads the tarball from codeload.github.com
   * 3. Extracts to ~/.hip/plugins/<slug>/
   * 4. Reads the plugin.json manifest
   * 5. Extracts component IDs (skills, MCP servers, agents)
   * 6. Derives trust surface
   * 7. Registers with the PluginStore
   *
   * Returns a summary of the installed plugin. Throws on any error.
   */
  async installFromGitHub(repoUrl: string): Promise<InstallFromGitHubResult> {
    const parsed = parseGitHubUrl(repoUrl)

    if (this.store.has(parsed.slug)) {
      throw new Error(`Plugin "${parsed.slug}" is already installed`)
    }

    const installDir = join(this.pluginsDir, parsed.slug)
    const tarballUrl = `https://codeload.github.com/${parsed.owner}/${parsed.repo}/tar.gz/refs/heads/main`

    await this.extractFn(tarballUrl, installDir)

    let manifest: RawPluginManifest
    try {
      manifest = readPluginManifest(installDir)
    } catch (err) {
      // Clean up on manifest read failure
      try { rmSync(installDir, { recursive: true, force: true }) } catch { /* ignore */ }
      throw err
    }

    const name = typeof manifest.name === 'string' ? manifest.name : parsed.repo
    const skills = extractSkillIds(manifest)
    const mcpServers = extractIds(manifest.mcpServers, installDir, 'servers')
    const agents = extractIds(manifest.agents, installDir, 'agents')
    const trust = deriveTrust(manifest)

    const entry: InstalledPlugin = {
      slug: parsed.slug,
      name,
      dir: installDir,
      skills,
      mcpServers,
      agents,
      trust,
      installedAt: Date.now(),
    }
    this.store.add(entry)

    return { slug: parsed.slug, name, skills, mcpServers, agents, trust }
  }

  /** List installed plugins via the store. */
  list(): InstalledPlugin[] {
    return this.store.list()
  }

  /** Remove an installed plugin by slug. Returns true if removed. */
  remove(slug: string): boolean {
    return this.store.remove(slug)
  }
}
