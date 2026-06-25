import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginManager, type InstallFromGitHubResult } from './plugin-manager.js'
import { PluginStore, type InstalledPlugin } from './plugin-store.js'

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal plugin manifest at .plugin/plugin.json inside dir. */
function writeManifest(dir: string, overrides: Record<string, unknown> = {}): void {
  const manifestDir = join(dir, '.plugin')
  mkdirSync(manifestDir, { recursive: true })
  const manifest: Record<string, unknown> = {
    name: 'test-plugin',
    version: '1.0.0',
    skills: ['./skills/code-review'],
    mcpServers: [{ id: 'mcp-test', name: 'Test MCP', transport: 'stdio', command: 'echo', enabled: true }],
    agents: [{ id: 'agent-test', name: 'Test Agent', kind: 'internal', command: 'echo', args: [], enabled: true }],
    ...overrides,
  }
  writeFileSync(join(manifestDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8')
}

/** Create a plugin manifest at plugin.json (root level) inside dir. */
function writeRootManifest(dir: string, overrides: Record<string, unknown> = {}): void {
  const manifest: Record<string, unknown> = {
    name: 'root-plugin',
    version: '2.0.0',
    skills: ['./skills/lint'],
    ...overrides,
  }
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8')
}

/** Build an extract function mock that creates the target dir with a manifest. */
function makeExtract(withManifest: (dir: string) => void) {
  return vi.fn(async (_url: string, targetDir: string) => {
    mkdirSync(targetDir, { recursive: true })
    withManifest(targetDir)
  })
}

// ─── test suite ───────────────────────────────────────────────────────────────

describe('PluginManager.installFromGitHub', () => {
  let pluginsDir: string
  let configPath: string
  let store: PluginStore
  let manager: PluginManager

  beforeEach(() => {
    pluginsDir = mkdtempSync(join(tmpdir(), 'hip-plugin-test-'))
    configPath = join(pluginsDir, 'plugins.json')
    writeFileSync(configPath, JSON.stringify({ plugins: [], entries: [] }), 'utf8')
    store = new PluginStore(configPath)
  })

  afterEach(() => {
    try { rmSync(pluginsDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  function makeManager(extract: (dir: string) => void = (d) => writeManifest(d)): PluginManager {
    return new PluginManager(store, pluginsDir, { extract: makeExtract(extract) })
  }

  // ─── happy path ─────────────────────────────────────────────────────────

  it('installs a plugin from a valid GitHub URL and returns component metadata', async () => {
    manager = makeManager()
    const result = await manager.installFromGitHub('https://github.com/test-owner/test-repo')

    expect(result).toEqual<InstallFromGitHubResult>({
      slug: 'test-repo',
      name: 'test-plugin',
      skills: ['code-review'],
      mcpServers: ['mcp-test'],
      agents: ['agent-test'],
      trust: ['read_files', 'network_access', 'run_scripts'],
    })
    expect(existsSync(join(pluginsDir, 'test-repo'))).toBe(true)
    expect(store.has('test-repo')).toBe(true)

    const list = store.list()
    expect(list).toHaveLength(1)
    expect(list[0].slug).toBe('test-repo')
    expect(list[0].skills).toEqual(['code-review'])
    expect(list[0].mcpServers).toEqual(['mcp-test'])
    expect(list[0].agents).toEqual(['agent-test'])
  })

  it('uses the repo name as the plugin name when manifest name is missing', async () => {
    manager = makeManager((dir) => writeManifest(dir, { name: undefined }))
    const result = await manager.installFromGitHub('https://github.com/owner/my-plugin')

    expect(result.name).toBe('my-plugin')
    expect(result.slug).toBe('my-plugin')
  })

  it('reads manifest from root plugin.json when .plugin/plugin.json is absent', async () => {
    manager = makeManager((dir) => writeRootManifest(dir))
    const result = await manager.installFromGitHub('https://github.com/owner/root-repo')

    expect(result.name).toBe('root-plugin')
    expect(result.skills).toEqual(['lint'])
    expect(result.slug).toBe('root-repo')
  })

  it('returns empty component arrays when manifest declares none', async () => {
    manager = makeManager((dir) => writeManifest(dir, { skills: undefined, mcpServers: undefined, agents: undefined, hooks: undefined }))
    const result = await manager.installFromGitHub('https://github.com/owner/minimal-repo')

    expect(result.skills).toEqual([])
    expect(result.mcpServers).toEqual([])
    expect(result.agents).toEqual([])
    expect(result.trust).toEqual([])
  })

  it('derives read_files trust from skills', async () => {
    manager = makeManager((dir) => writeManifest(dir, { skills: ['./skills/docs'], mcpServers: undefined, agents: undefined }))
    const result = await manager.installFromGitHub('https://github.com/owner/readonly-plugin')

    expect(result.trust).toEqual(['read_files'])
  })

  it('derives network_access trust from mcpServers', async () => {
    manager = makeManager((dir) => writeManifest(dir, { skills: undefined, agents: undefined }))
    const result = await manager.installFromGitHub('https://github.com/owner/mcp-plugin')

    expect(result.trust).toContain('network_access')
  })

  it('derives run_scripts trust from agents', async () => {
    manager = makeManager((dir) => writeManifest(dir, { skills: undefined, mcpServers: undefined }))
    const result = await manager.installFromGitHub('https://github.com/owner/agent-plugin')

    expect(result.trust).toContain('run_scripts')
  })

  it('derives write_files trust from hooks', async () => {
    manager = makeManager((dir) => writeManifest(dir, { skills: undefined, mcpServers: undefined, agents: undefined, hooks: ['./hooks/pre-tool.cjs'] }))
    const result = await manager.installFromGitHub('https://github.com/owner/hook-plugin')

    expect(result.trust).toEqual(['write_files'])
  })

  it('handles a .git suffix in the URL', async () => {
    manager = makeManager()
    const result = await manager.installFromGitHub('https://github.com/owner/repo.git')

    expect(result.slug).toBe('repo')
  })

  it('handles a /tree/main suffix in the URL', async () => {
    manager = makeManager((dir) => writeManifest(dir, { name: 'repo' }))
    const result = await manager.installFromGitHub('https://github.com/owner/repo/tree/main')

    expect(result.slug).toBe('repo')
  })

  // ─── invalid URL ─────────────────────────────────────────────────────────

  it('throws for a non-GitHub URL', async () => {
    manager = makeManager()
    await expect(
      manager.installFromGitHub('https://gitlab.com/owner/repo'),
    ).rejects.toThrow('Not a GitHub URL')
  })

  it('throws for a malformed URL', async () => {
    manager = makeManager()
    await expect(
      manager.installFromGitHub('not-a-url'),
    ).rejects.toThrow('Invalid URL')
  })

  it('throws for a GitHub URL with insufficient path segments', async () => {
    manager = makeManager()
    await expect(
      manager.installFromGitHub('https://github.com/only-owner'),
    ).rejects.toThrow('Invalid GitHub URL')
  })

  // ─── already installed ──────────────────────────────────────────────────

  it('throws when the plugin is already installed', async () => {
    // Pre-register the slug
    store.add({
      slug: 'test-repo',
      name: 'Test',
      dir: join(pluginsDir, 'test-repo'),
      skills: [],
      mcpServers: [],
      agents: [],
      trust: [],
      installedAt: Date.now(),
    })

    manager = makeManager()
    await expect(
      manager.installFromGitHub('https://github.com/owner/test-repo'),
    ).rejects.toThrow('already installed')
  })

  // ─── non-existent repo ──────────────────────────────────────────────────

  it('throws when GitHub returns a non-200 status (non-existent repo)', async () => {
    const extractError = vi.fn(async (_url: string, _targetDir: string) => {
      throw new Error('GitHub download failed: HTTP 404 Not Found')
    })
    manager = new PluginManager(store, pluginsDir, { extract: extractError })

    await expect(
      manager.installFromGitHub('https://github.com/owner/nonexistent'),
    ).rejects.toThrow('GitHub download failed')
  })

  // ─── PluginManager.list / remove ────────────────────────────────────────

  it('list() returns installed plugins from the store', async () => {
    store.add({
      slug: 'p1',
      name: 'Plugin 1',
      dir: join(pluginsDir, 'p1'),
      skills: ['lint'],
      mcpServers: [],
      agents: [],
      trust: ['read_files'],
      installedAt: 1000,
    })

    manager = new PluginManager(store, pluginsDir)
    const list = manager.list()
    expect(list).toHaveLength(1)
    expect(list[0].slug).toBe('p1')
  })

  it('remove() deletes a plugin by slug', async () => {
    store.add({
      slug: 'p1',
      name: 'Plugin 1',
      dir: join(pluginsDir, 'p1'),
      skills: [],
      mcpServers: [],
      agents: [],
      trust: [],
      installedAt: 1000,
    })

    manager = new PluginManager(store, pluginsDir)
    expect(manager.remove('p1')).toBe(true)
    expect(store.list()).toHaveLength(0)
  })

  it('remove() returns false when slug is not found', async () => {
    manager = new PluginManager(store, pluginsDir)
    expect(manager.remove('nonexistent')).toBe(false)
  })

  // ─── manifest read failure cleans up extracted dir ──────────────────────

  it('cleans up the extracted directory when manifest reading fails', async () => {
    // Extract creates an empty dir with no manifest
    manager = new PluginManager(store, pluginsDir, {
      extract: vi.fn(async (_url: string, targetDir: string) => {
        mkdirSync(targetDir, { recursive: true })
        // No manifest file created
      }),
    })

    await expect(
      manager.installFromGitHub('https://github.com/owner/bad-manifest'),
    ).rejects.toThrow('No plugin.json found')

    // The install dir should be cleaned up
    const installDir = join(pluginsDir, 'bad-manifest')
    expect(existsSync(installDir)).toBe(false)
  })
})
