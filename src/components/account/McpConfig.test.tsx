import { describe, it, expect } from 'vitest'
import { derivePluginMcpServers } from './McpConfig'
import type { McpServerConfig, PluginMeta } from '@hip/protocol'

function makeServer(id: string, overrides?: Partial<McpServerConfig>): McpServerConfig {
  return {
    id,
    name: `Server ${id}`,
    transport: 'stdio',
    command: 'npx',
    enabled: true,
    ...overrides,
  }
}

function makePlugin(id: string, name: string, servers: McpServerConfig[]): PluginMeta {
  return {
    id,
    name,
    version: '1.0.0',
    description: '',
    dir: `/tmp/plugins/${id}`,
    skills: [],
    mcpServers: servers,
    agents: [],
    hookCount: 0,
  }
}

describe('derivePluginMcpServers', () => {
  it('includes plugin MCP servers that are not standalone', () => {
    const standalone = new Set(['standalone-1'])
    const plugin = makePlugin('plugin-a', 'Plugin A', [makeServer('plugin-mcp-1')])

    const result = derivePluginMcpServers([plugin], standalone)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('plugin-mcp-1')
    expect(result[0].pluginId).toBe('plugin-a')
    expect(result[0].pluginName).toBe('Plugin A')
  })

  it('hides plugin MCP server when its id collides with a standalone server', () => {
    const standalone = new Set<string>(['shared-id'])
    const plugin = makePlugin('plugin-a', 'Plugin A', [makeServer('shared-id')])

    const result = derivePluginMcpServers([plugin], standalone)

    expect(result).toHaveLength(0)
  })

  it('keeps the first plugin server when two plugins export the same id', () => {
    const standalone = new Set<string>()
    const pluginA = makePlugin('plugin-a', 'Plugin A', [makeServer('dup-id', { name: 'A Server' })])
    const pluginB = makePlugin('plugin-b', 'Plugin B', [makeServer('dup-id', { name: 'B Server' })])

    const result = derivePluginMcpServers([pluginA, pluginB], standalone)

    expect(result).toHaveLength(1)
    expect(result[0].pluginId).toBe('plugin-a')
    expect(result[0].pluginName).toBe('Plugin A')
    expect(result[0].name).toBe('A Server')
  })

  it('returns multiple distinct plugin servers across plugins', () => {
    const standalone = new Set<string>()
    const pluginA = makePlugin('plugin-a', 'Plugin A', [makeServer('a-1')])
    const pluginB = makePlugin('plugin-b', 'Plugin B', [makeServer('b-1')])

    const result = derivePluginMcpServers([pluginA, pluginB], standalone)

    expect(result).toHaveLength(2)
    expect(result.map((s) => s.id)).toEqual(['a-1', 'b-1'])
  })

  it('preserves server config fields on derived entries', () => {
    const standalone = new Set<string>()
    const server = makeServer('s-1', {
      transport: 'sse',
      url: 'https://example.com/mcp',
      enabled: false,
    })
    const plugin = makePlugin('plugin-a', 'Plugin A', [server])

    const result = derivePluginMcpServers([plugin], standalone)

    expect(result[0]).toMatchObject({
      id: 's-1',
      name: 'Server s-1',
      transport: 'sse',
      url: 'https://example.com/mcp',
      enabled: false,
      pluginId: 'plugin-a',
      pluginName: 'Plugin A',
    })
  })
})
