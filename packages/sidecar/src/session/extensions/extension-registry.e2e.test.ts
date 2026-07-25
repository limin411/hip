/**
 * Process-level e2e for ExtensionRegistry: disk → load → ACP list → preflight.
 * No Tauri / WDIO; exercises the same SSOT the desktop agent uses.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadExtensions, listResolvedHipMcpServers, inspectExtensions } from './load.js'
import { preflightPluginEnable } from './preflight.js'
import { listEnabledHipMcpServers } from '../agents/acp-mcp-list.js'
import { ConfigManager } from '../config-manager.js'
import { HookRegistry } from '../hooks/registry.js'
import type { SessionConfig } from '@hip/protocol'

function tmpDir(): string {
  const d = join(tmpdir(), `hip-ext-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(d, { recursive: true })
  return d
}

describe('extension-registry process e2e @extensions', () => {
  const dirs: string[] = []
  const prev: Record<string, string | undefined> = {}

  function setEnv(k: string, v: string) {
    if (!(k in prev)) prev[k] = process.env[k]
    process.env[k] = v
  }

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      if (existsSync(d)) rmSync(d, { recursive: true, force: true })
    }
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
      delete prev[k]
    }
  })

  function stageWorld(): { root: string; cwd: string; pluginDir: string } {
    const root = tmpDir()
    dirs.push(root)
    const cwd = join(root, 'proj')
    mkdirSync(cwd, { recursive: true })

    // Project skill wins over plugin same id
    mkdirSync(join(cwd, '.hip', 'skills', 'shared-formatter'), { recursive: true })
    writeFileSync(
      join(cwd, '.hip', 'skills', 'shared-formatter', 'SKILL.md'),
      '---\nname: Project Formatter\ndescription: project wins\n---\n# project\n',
    )

    const pluginDir = join(root, 'conflict-plugin')
    mkdirSync(join(pluginDir, '.plugin'), { recursive: true })
    mkdirSync(join(pluginDir, 'skills', 'shared-formatter'), { recursive: true })
    writeFileSync(
      join(pluginDir, '.plugin', 'plugin.json'),
      JSON.stringify({
        id: 'conflict-plugin',
        name: 'conflict-plugin',
        version: '0.0.1',
        skills: ['./skills/shared-formatter'],
        mcpServers: [
          {
            id: 'plugin-devtools',
            name: 'Plugin DevTools',
            transport: 'stdio',
            command: '/bin/true',
            args: ['chrome-devtools-mcp'],
            enabled: true,
          },
        ],
      }),
    )
    writeFileSync(
      join(pluginDir, 'skills', 'shared-formatter', 'SKILL.md'),
      '---\nname: Plugin Formatter\ndescription: plugin loses\n---\n# plugin\n',
    )

    writeFileSync(
      join(root, 'hip.toml'),
      `version = 1

[[mcpServers]]
id = "e2e-user-devtools"
name = "User DevTools"
transport = "stdio"
command = "/bin/true"
args = ["chrome-devtools-mcp"]
enabled = true
`,
    )
    writeFileSync(
      join(root, 'hip-plugins.json'),
      JSON.stringify({ plugins: [pluginDir] }),
    )

    setEnv('HIP_DATA_DIR', root)
    setEnv('HIP_CONFIG_PATH', join(root, 'hip.toml'))
    setEnv('HIP_PLUGINS_PATH', join(root, 'hip-plugins.json'))
    setEnv('HIP_SKILLS_DIR', join(root, 'empty-skills'))
    mkdirSync(join(root, 'empty-skills'), { recursive: true })

    return { root, cwd, pluginDir }
  }

  it('resolves project skill + user MCP over plugin; ACP list matches ConfigManager', () => {
    const { cwd } = stageWorld()

    const loaded = loadExtensions(cwd)
    const fmt = loaded.skills.find((s) => s.id === 'shared-formatter')
    expect(fmt?.name).toBe('Project Formatter')
    expect(fmt?.scope).toBe('project')

    const activeIds = loaded.mcpConfigs.map((m) => m.id).sort()
    expect(activeIds).toEqual(['e2e-user-devtools'])
    expect(loaded.mcpConfigs.find((m) => m.id === 'plugin-devtools')).toBeUndefined()

    const capConflict = loaded.conflicts.find((c) => c.kind === 'mcp_capability_duplicate')
    expect(capConflict).toBeDefined()
    expect(capConflict!.fingerprint).toContain('chrome-devtools-mcp')

    const skillShadow = loaded.conflicts.find(
      (c) => c.kind === 'skill_id_shadow' && c.loser.kind === 'plugin_skill',
    )
    expect(skillShadow).toBeDefined()

    // ACP forward path must match session tooling
    const acp = listEnabledHipMcpServers(cwd).map((m) => m.id).sort()
    const listed = listResolvedHipMcpServers(cwd).map((m) => m.id).sort()
    expect(acp).toEqual(listed)
    expect(acp).toEqual(['e2e-user-devtools'])

    // ConfigManager uses same SSOT
    let config: SessionConfig = {
      llmProvider: 'test',
      model: 'test',
      tools: [],
      cwd,
    }
    const mgr = new ConfigManager(
      () => config,
      (n) => {
        config = n
      },
      () => false,
      false,
      () => {},
      () => false,
      () => false,
      () => {},
      new HookRegistry(),
    )
    mgr.loadPluginComponents()
    expect(mgr.skills.find((s) => s.id === 'shared-formatter')?.name).toBe('Project Formatter')
    expect(mgr.mcpConfigs.map((m) => m.id)).toEqual(['e2e-user-devtools'])
    expect(
      mgr.extensionConflicts.some((c) => c.kind === 'mcp_capability_duplicate'),
    ).toBe(true)
  })

  it('name veto: disabled toml id blocks plugin fill-in', () => {
    const { root, cwd, pluginDir } = stageWorld()
    writeFileSync(
      join(root, 'hip.toml'),
      `version = 1

[[mcpServers]]
id = "plugin-devtools"
name = "Veto"
transport = "stdio"
command = "/bin/true"
args = ["other-pkg"]
enabled = false
`,
    )

    const snap = inspectExtensions(cwd)
    const active = snap.mcpServers.filter((m) => m.active)
    expect(active.find((m) => m.id === 'plugin-devtools')).toBeUndefined()
    expect(snap.conflicts.some((c) => c.kind === 'mcp_name_veto')).toBe(true)

    // Preflight when enabling another copy of the plugin still reports id claim
    writeFileSync(
      join(root, 'hip-plugins.json'),
      JSON.stringify({ plugins: [], enabled: { 'conflict-plugin': false } }),
    )
    // re-register path but disabled — preflight uses pluginDir directly
    const pf = preflightPluginEnable(cwd, pluginDir)
    // Toml claims plugin-devtools id as veto — capability may still flag vs other servers
    expect(pf.mcpIdConflicts.some((c) => c.id === 'plugin-devtools') || pf.hasConflicts).toBe(true)
  })

  it('allowDuplicate keeps both capability clones active', () => {
    const { root, cwd } = stageWorld()
    writeFileSync(
      join(root, 'hip.toml'),
      `version = 1

[[mcpServers]]
id = "e2e-user-devtools"
name = "User DevTools"
transport = "stdio"
command = "/bin/true"
args = ["chrome-devtools-mcp"]
enabled = true
allowDuplicate = true
`,
    )

    const loaded = loadExtensions(cwd)
    const activeIds = loaded.mcpConfigs.map((m) => m.id).sort()
    expect(activeIds).toContain('e2e-user-devtools')
    expect(activeIds).toContain('plugin-devtools')
  })
})
