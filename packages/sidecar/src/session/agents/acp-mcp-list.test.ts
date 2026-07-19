import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveEffectiveConfig } from '../../config/hip-config.js'
import type { AcpAgentRuntimeCaps } from './acp-connection.js'
import { buildMcpServersForAcp, listEnabledHipMcpServers } from './acp-mcp-list.js'

const tmpDirs: string[] = []
const prevConfig = process.env.HIP_CONFIG_PATH
const prevPlugins = process.env.HIP_PLUGINS_PATH

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ok */ }
  }
  if (prevConfig === undefined) delete process.env.HIP_CONFIG_PATH
  else process.env.HIP_CONFIG_PATH = prevConfig
  if (prevPlugins === undefined) delete process.env.HIP_PLUGINS_PATH
  else process.env.HIP_PLUGINS_PATH = prevPlugins
})

function tmp(label: string): string {
  const d = join(tmpdir(), `hip-mcp-list-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(d, { recursive: true })
  tmpDirs.push(d)
  return d
}

function writeToml(dir: string, body: string): string {
  const p = join(dir, 'hip.toml')
  writeFileSync(p, body)
  return p
}

/** Minimal plugin dir with one stdio MCP server in .plugin/plugin.json. */
function writePluginWithMcp(pluginDir: string, mcpId = 'plugin-mcp'): void {
  mkdirSync(join(pluginDir, '.plugin'), { recursive: true })
  writeFileSync(
    join(pluginDir, '.plugin', 'plugin.json'),
    JSON.stringify({
      name: 'mcp-plugin',
      version: '1.0.0',
      mcpServers: [
        {
          id: mcpId,
          name: 'Plugin MCP',
          transport: 'stdio',
          command: 'node',
          args: ['plugin-server.js'],
          enabled: true,
        },
      ],
    }),
  )
}

const caps: AcpAgentRuntimeCaps = {
  loadSession: true,
  closeSession: true,
  resumeSession: false,
  mcp: { http: true, sse: true },
}

describe('listEnabledHipMcpServers', () => {
  it('returns empty array when no toml mcp and no plugins', () => {
    const dir = tmp('empty')
    process.env.HIP_CONFIG_PATH = writeToml(dir, 'version = 1\n')
    delete process.env.HIP_PLUGINS_PATH
    expect(listEnabledHipMcpServers(dir)).toEqual([])
  })

  it('includes hip.toml mcpServers from resolveEffectiveConfig', () => {
    const dir = tmp('toml')
    process.env.HIP_CONFIG_PATH = writeToml(
      dir,
      `version = 1

[[mcpServers]]
id = "toml-mcp"
name = "Toml MCP"
transport = "stdio"
command = "npx"
args = ["-y", "x"]
enabled = true
`,
    )
    delete process.env.HIP_PLUGINS_PATH
    const listed = listEnabledHipMcpServers(dir)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: 'toml-mcp', name: 'Toml MCP', command: 'npx' })
  })

  it('includes enabled plugin MCP that resolveEffectiveConfig alone omits', () => {
    const root = tmp('plugin')
    const pluginDir = join(root, 'plugins', 'mcp-plugin')
    writePluginWithMcp(pluginDir)

    process.env.HIP_CONFIG_PATH = writeToml(root, 'version = 1\n')
    const pluginsCfg = join(root, 'plugins.json')
    writeFileSync(pluginsCfg, JSON.stringify({ plugins: [pluginDir] }))
    process.env.HIP_PLUGINS_PATH = pluginsCfg

    // Toml-only path must NOT see plugin MCP
    const tomlOnly = resolveEffectiveConfig(root).mcpServers ?? []
    expect(tomlOnly.find((s) => s.id === 'plugin-mcp')).toBeUndefined()

    // Shared list MUST include plugin MCP
    const listed = listEnabledHipMcpServers(root)
    expect(listed.find((s) => s.id === 'plugin-mcp')).toMatchObject({
      id: 'plugin-mcp',
      name: 'Plugin MCP',
      command: 'node',
    })
  })

  it('skips plugins disabled in plugins config', () => {
    const root = tmp('disabled-plugin')
    const pluginDir = join(root, 'plugins', 'mcp-plugin')
    writePluginWithMcp(pluginDir)

    process.env.HIP_CONFIG_PATH = writeToml(root, 'version = 1\n')
    const pluginsCfg = join(root, 'plugins.json')
    writeFileSync(
      pluginsCfg,
      JSON.stringify({ plugins: [pluginDir], enabled: { 'mcp-plugin': false } }),
    )
    process.env.HIP_PLUGINS_PATH = pluginsCfg

    expect(listEnabledHipMcpServers(root).find((s) => s.id === 'plugin-mcp')).toBeUndefined()
  })

  it('merges toml + plugin entries', () => {
    const root = tmp('merge')
    const pluginDir = join(root, 'plugins', 'mcp-plugin')
    writePluginWithMcp(pluginDir, 'from-plugin')

    process.env.HIP_CONFIG_PATH = writeToml(
      root,
      `version = 1

[[mcpServers]]
id = "from-toml"
name = "Toml"
transport = "stdio"
command = "echo"
enabled = true
`,
    )
    const pluginsCfg = join(root, 'plugins.json')
    writeFileSync(pluginsCfg, JSON.stringify({ plugins: [pluginDir] }))
    process.env.HIP_PLUGINS_PATH = pluginsCfg

    const ids = listEnabledHipMcpServers(root).map((s) => s.id)
    expect(ids).toContain('from-toml')
    expect(ids).toContain('from-plugin')
  })
})

describe('buildMcpServersForAcp', () => {
  it('returns [] when forwardMcp is false (default)', () => {
    const dir = tmp('fwd-off')
    process.env.HIP_CONFIG_PATH = writeToml(
      dir,
      `version = 1

[[mcpServers]]
id = "x"
name = "X"
transport = "stdio"
command = "echo"
enabled = true
`,
    )
    delete process.env.HIP_PLUGINS_PATH
    // default forwardMcp=false
    expect(buildMcpServersForAcp(dir, caps)).toEqual([])
  })

  it('returns [] when [acp].forwardMcp = false explicitly with servers present', () => {
    const dir = tmp('fwd-explicit-off')
    process.env.HIP_CONFIG_PATH = writeToml(
      dir,
      `version = 1

[acp]
forwardMcp = false

[[mcpServers]]
id = "x"
name = "X"
transport = "stdio"
command = "echo"
enabled = true
`,
    )
    expect(buildMcpServersForAcp(dir, caps)).toEqual([])
  })

  it('forwards mapped servers when forwardMcp = true (incl. plugin)', () => {
    const root = tmp('fwd-on')
    const pluginDir = join(root, 'plugins', 'mcp-plugin')
    writePluginWithMcp(pluginDir)

    process.env.HIP_CONFIG_PATH = writeToml(
      root,
      `version = 1

[acp]
forward_mcp = true

[[mcpServers]]
id = "toml-mcp"
name = "Toml MCP"
transport = "stdio"
command = "npx"
args = ["-y", "fs"]
enabled = true
`,
    )
    const pluginsCfg = join(root, 'plugins.json')
    writeFileSync(pluginsCfg, JSON.stringify({ plugins: [pluginDir] }))
    process.env.HIP_PLUGINS_PATH = pluginsCfg

    const mapped = buildMcpServersForAcp(root, caps)
    expect(mapped).toEqual(
      expect.arrayContaining([
        {
          name: 'Toml MCP',
          command: 'npx',
          args: ['-y', 'fs'],
          env: [],
        },
        {
          name: 'Plugin MCP',
          command: 'node',
          args: ['plugin-server.js'],
          env: [],
        },
      ]),
    )
    expect(mapped).toHaveLength(2)
  })

  it('returns empty mapped list when forwardMcp true but no servers', () => {
    const dir = tmp('fwd-empty')
    process.env.HIP_CONFIG_PATH = writeToml(
      dir,
      `version = 1

[acp]
forwardMcp = true
`,
    )
    delete process.env.HIP_PLUGINS_PATH
    expect(buildMcpServersForAcp(dir, caps)).toEqual([])
  })
})
