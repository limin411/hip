import { describe, it, expect } from 'vitest'
import type {
  ExtensionRegistrySnapshot,
  McpServerConfig,
  PluginMeta,
  SkillMeta,
} from '@hip/protocol'
import {
  derivePluginMcpFromSnapshot,
  mcpRowsFromSnapshot,
  partitionSkillsFromSnapshot,
} from './extensionSnapshot'

function skill(id: string, overrides: Partial<SkillMeta> = {}): SkillMeta {
  return {
    id,
    name: id,
    description: '',
    dir: `/s/${id}`,
    hasScripts: false,
    ...overrides,
  }
}

function mcp(id: string, overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id,
    name: id,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'pkg'],
    enabled: true,
    ...overrides,
  }
}

function plugin(id: string): PluginMeta {
  return {
    id,
    name: `Plugin ${id}`,
    version: '1.0.0',
    description: '',
    dir: `/p/${id}`,
    skills: [],
    mcpServers: [],
    agents: [],
    hookCount: 0,
    hookEvents: [],
    enabled: true,
  }
}

const snap: ExtensionRegistrySnapshot = {
  generatedAt: 1,
  conflicts: [],
  skills: [
    {
      id: 'fmt',
      active: true,
      meta: skill('fmt', { scope: 'project' }),
      winner: { kind: 'project_skill', configId: 'fmt' },
    },
    {
      id: 'plug-skill',
      active: true,
      meta: skill('plug-skill', { scope: 'plugin', pluginId: 'p1' }),
      winner: { kind: 'plugin_skill', pluginId: 'p1', configId: 'plug-skill' },
    },
    {
      id: 'shadowed',
      active: false,
      meta: skill('shadowed', { scope: 'plugin', pluginId: 'p1' }),
      winner: { kind: 'plugin_skill', pluginId: 'p1', configId: 'shadowed' },
      shadowedBy: { kind: 'project_skill', configId: 'shadowed' },
    },
  ],
  mcpServers: [
    {
      id: 'user-m',
      active: true,
      config: mcp('user-m'),
      winner: { kind: 'user_mcp', configId: 'user-m' },
      fingerprint: 'stdio:pkg:pkg',
    },
    {
      id: 'plug-m',
      active: false,
      config: mcp('plug-m', { pluginId: 'p1' }),
      winner: { kind: 'plugin_mcp', pluginId: 'p1', configId: 'plug-m' },
      fingerprint: 'stdio:pkg:pkg',
      shadowedBy: { kind: 'user_mcp', configId: 'user-m' },
    },
  ],
}

describe('extensionSnapshot helpers', () => {
  it('mcpRowsFromSnapshot marks inactive capability losers', () => {
    const rows = mcpRowsFromSnapshot(snap, [plugin('p1')])
    const plug = rows.find((r) => r.id === 'plug-m')
    expect(plug?.registryActive).toBe(false)
    expect(plug?.shadowedReason).toContain('user_mcp')
    expect(plug?.pluginName).toBe('Plugin p1')
  })

  it('derivePluginMcpFromSnapshot keeps only plugin_mcp sources', () => {
    const rows = derivePluginMcpFromSnapshot(snap, [plugin('p1')], new Set())
    expect(rows.map((r) => r.id)).toEqual(['plug-m'])
  })

  it('partitionSkillsFromSnapshot splits standalone vs plugin', () => {
    const { standalone, pluginEntries } = partitionSkillsFromSnapshot(snap, [plugin('p1')])
    expect(standalone.map((s) => s.id)).toEqual(['fmt'])
    expect(pluginEntries.map((e) => e.skill.id).sort()).toEqual(['plug-skill', 'shadowed'])
    const sh = pluginEntries.find((e) => e.skill.id === 'shadowed')
    expect(sh?.registryActive).toBe(false)
  })
})
