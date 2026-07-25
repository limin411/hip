import { describe, it, expect } from 'vitest'
import type { McpServerConfig, SkillMeta } from './index.js'
import {
  extractNpmPackageHint,
  mcpCapabilityFingerprint,
  resolveMcpCandidates,
  resolveSkillCandidates,
  SKILL_TIER,
  MCP_TIER,
} from './extension-registry.js'

function skill(id: string, name: string, dir: string): SkillMeta {
  return {
    id,
    name,
    description: `${name} desc`,
    dir,
    hasScripts: false,
  }
}

function mcp(partial: Partial<McpServerConfig> & Pick<McpServerConfig, 'id' | 'name'>): McpServerConfig {
  return {
    transport: 'stdio',
    enabled: true,
    command: 'npx',
    args: [],
    ...partial,
  }
}

describe('extractNpmPackageHint', () => {
  it('parses npx -y package@version', () => {
    expect(extractNpmPackageHint(['-y', 'chrome-devtools-mcp@1.6.0'])).toBe('chrome-devtools-mcp')
  })

  it('parses scoped packages', () => {
    expect(extractNpmPackageHint(['-y', '@modelcontextprotocol/server-github@latest'])).toBe(
      '@modelcontextprotocol/server-github',
    )
  })

  it('ignores script paths', () => {
    expect(extractNpmPackageHint(['./server.js'])).toBeUndefined()
  })
})

describe('mcpCapabilityFingerprint', () => {
  it('fingerprints stdio by package hint', () => {
    const fp = mcpCapabilityFingerprint(
      mcp({
        id: 'a',
        name: 'A',
        command: 'npx',
        args: ['-y', 'chrome-devtools-mcp@latest'],
      }),
    )
    expect(fp).toBe('stdio:pkg:chrome-devtools-mcp')
  })

  it('fingerprints http by origin+path', () => {
    const fp = mcpCapabilityFingerprint(
      mcp({
        id: 'b',
        name: 'B',
        transport: 'http',
        url: 'https://mcp.example.com/api/v1?x=1',
        command: undefined,
        args: undefined,
      }),
    )
    expect(fp).toBe('http:https://mcp.example.com/api/v1')
  })
})

describe('resolveSkillCandidates', () => {
  it('prefers project over plugin over builtin', () => {
    const { skills, conflicts } = resolveSkillCandidates([
      {
        id: 'fmt',
        meta: skill('fmt', 'Builtin', '/b'),
        source: { kind: 'builtin', configId: 'fmt' },
        tier: SKILL_TIER.builtin,
        order: 0,
      },
      {
        id: 'fmt',
        meta: skill('fmt', 'Plugin', '/p'),
        source: { kind: 'plugin_skill', pluginId: 'plug', configId: 'fmt' },
        tier: SKILL_TIER.plugin,
        order: 0,
      },
      {
        id: 'fmt',
        meta: skill('fmt', 'Project', '/proj'),
        source: { kind: 'project_skill', configId: 'fmt' },
        tier: SKILL_TIER.project,
        order: 0,
      },
    ])
    const active = skills.filter((s) => s.active)
    expect(active).toHaveLength(1)
    expect(active[0]!.meta.name).toBe('Project')
    expect(conflicts.filter((c) => c.kind === 'skill_id_shadow')).toHaveLength(2)
  })

  it('marks disabled skills inactive', () => {
    const { skills } = resolveSkillCandidates(
      [
        {
          id: 'hip',
          meta: skill('hip', 'hip', '/b'),
          source: { kind: 'builtin', configId: 'hip' },
          tier: SKILL_TIER.builtin,
          order: 0,
        },
      ],
      new Set(['hip']),
    )
    expect(skills[0]!.active).toBe(false)
  })
})

describe('resolveMcpCandidates', () => {
  it('user config wins over plugin same id', () => {
    const { mcpServers, conflicts } = resolveMcpCandidates([
      {
        id: 'devtools',
        config: mcp({
          id: 'devtools',
          name: 'User',
          args: ['-y', 'chrome-devtools-mcp@1'],
        }),
        source: { kind: 'user_mcp', configId: 'devtools' },
        tier: MCP_TIER.config,
        order: 0,
      },
      {
        id: 'devtools',
        config: mcp({
          id: 'devtools',
          name: 'Plugin',
          pluginId: 'cdp',
          args: ['-y', 'chrome-devtools-mcp@2'],
        }),
        source: { kind: 'plugin_mcp', pluginId: 'cdp', configId: 'devtools' },
        tier: MCP_TIER.plugin,
        order: 0,
      },
    ])
    const active = mcpServers.filter((m) => m.active)
    expect(active).toHaveLength(1)
    expect(active[0]!.config.name).toBe('User')
    expect(conflicts.some((c) => c.kind === 'mcp_id_shadow')).toBe(true)
  })

  it('disabled toml id vetoes plugin fill-in', () => {
    const { mcpServers, conflicts } = resolveMcpCandidates([
      {
        id: 'devtools',
        config: mcp({ id: 'devtools', name: 'Off', enabled: false }),
        source: { kind: 'user_mcp', configId: 'devtools' },
        tier: MCP_TIER.config,
        order: 0,
        vetoOnly: true,
      },
      {
        id: 'devtools',
        config: mcp({
          id: 'devtools',
          name: 'Plugin',
          pluginId: 'cdp',
          args: ['-y', 'chrome-devtools-mcp'],
        }),
        source: { kind: 'plugin_mcp', pluginId: 'cdp', configId: 'devtools' },
        tier: MCP_TIER.plugin,
        order: 0,
      },
    ])
    expect(mcpServers.every((m) => !m.active)).toBe(true)
    expect(conflicts.some((c) => c.kind === 'mcp_name_veto')).toBe(true)
  })

  it('demotes capability duplicates across different ids', () => {
    const { mcpServers, conflicts } = resolveMcpCandidates([
      {
        id: 'user-cdp',
        config: mcp({
          id: 'user-cdp',
          name: 'User CDP',
          args: ['-y', 'chrome-devtools-mcp@1.6.0'],
        }),
        source: { kind: 'user_mcp', configId: 'user-cdp' },
        tier: MCP_TIER.config,
        order: 0,
      },
      {
        id: 'plugin-cdp',
        config: mcp({
          id: 'plugin-cdp',
          name: 'Plugin CDP',
          pluginId: 'chrome-devtools',
          args: ['-y', 'chrome-devtools-mcp@latest'],
        }),
        source: { kind: 'plugin_mcp', pluginId: 'chrome-devtools', configId: 'plugin-cdp' },
        tier: MCP_TIER.plugin,
        order: 0,
      },
    ])
    const active = mcpServers.filter((m) => m.active)
    expect(active).toHaveLength(1)
    expect(active[0]!.id).toBe('user-cdp')
    expect(conflicts.some((c) => c.kind === 'mcp_capability_duplicate')).toBe(true)
  })

  it('allowDuplicate keeps both capability clones', () => {
    const { mcpServers } = resolveMcpCandidates([
      {
        id: 'user-cdp',
        config: mcp({
          id: 'user-cdp',
          name: 'User CDP',
          args: ['-y', 'chrome-devtools-mcp'],
          allowDuplicate: true,
        }),
        source: { kind: 'user_mcp', configId: 'user-cdp' },
        tier: MCP_TIER.config,
        order: 0,
        allowDuplicate: true,
      },
      {
        id: 'plugin-cdp',
        config: mcp({
          id: 'plugin-cdp',
          name: 'Plugin CDP',
          args: ['-y', 'chrome-devtools-mcp'],
        }),
        source: { kind: 'plugin_mcp', pluginId: 'p', configId: 'plugin-cdp' },
        tier: MCP_TIER.plugin,
        order: 0,
      },
    ])
    // keep allows duplicate → skip demotion for group
    expect(mcpServers.filter((m) => m.active)).toHaveLength(2)
  })
})
