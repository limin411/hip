// packages/sidecar/src/session/plugins/synthesizer.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { PluginManifest, McpServerConfig, AgentConfig, Hook } from '@hip/protocol'
import { synthesizePlugin } from './synthesizer.js'
import type { SynthesizedSkillEntry, SynthesizedMcpEntry, SynthesizedAgentEntry, SynthesizedHookEntry } from './synthesizer.js'

const dirs: string[] = []

function tempDir(label: string): string {
  const d = join(tmpdir(), `hip-synth-${Date.now()}-${label}-${Math.random().toString(36).slice(2, 8)}`)
  dirs.push(d)
  mkdirSync(d, { recursive: true })
  return d
}

function makeFile(parent: string, name: string, content: string): string {
  const p = join(parent, name)
  writeFileSync(p, content)
  return p
}

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    ...overrides,
  }
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

// ─── Empty / no components ──────────────────────────────────────────────

describe('synthesizePlugin — empty manifest', () => {
  it('returns empty arrays when manifest has no components', () => {
    const m = makeManifest()
    const r = synthesizePlugin(m)
    expect(r.pluginId).toBe('test-plugin')
    expect(r.skills).toEqual([])
    expect(r.mcpServers).toEqual([])
    expect(r.agents).toEqual([])
    expect(r.hooks).toEqual([])
  })

  it('returns empty arrays when all component fields are undefined', () => {
    const m = makeManifest({
      skills: undefined,
      mcpServers: undefined,
      agents: undefined,
    })
    const r = synthesizePlugin(m)
    expect(r.skills).toEqual([])
    expect(r.mcpServers).toEqual([])
    expect(r.agents).toEqual([])
    expect(r.hooks).toEqual([])
  })
})

// ─── Skills ─────────────────────────────────────────────────────────────

describe('synthesizePlugin — skills', () => {
  it('synthesizes a single skill string path into an entry', () => {
    const pluginDir = tempDir('plugin')
    const skillDir = join(pluginDir, 'skills', 'my-skill')
    mkdirSync(skillDir, { recursive: true })

    const m = makeManifest({ skills: skillDir })
    const r = synthesizePlugin(m)

    expect(r.skills).toHaveLength(1)
    expect(r.skills[0]).toEqual<SynthesizedSkillEntry>({
      id: 'my-skill',
      dir: skillDir,
      pluginId: 'test-plugin',
    })
  })

  it('synthesizes a skill string[] into multiple entries', () => {
    const pluginDir = tempDir('plugin')
    const a = join(pluginDir, 'skills', 'skill-a')
    const b = join(pluginDir, 'skills', 'skill-b')
    mkdirSync(a, { recursive: true })
    mkdirSync(b, { recursive: true })

    const m = makeManifest({ skills: [a, b] })
    const r = synthesizePlugin(m)

    expect(r.skills).toHaveLength(2)
    expect(r.skills[0].id).toBe('skill-a')
    expect(r.skills[0].dir).toBe(a)
    expect(r.skills[1].id).toBe('skill-b')
    expect(r.skills[1].dir).toBe(b)
    for (const s of r.skills) expect(s.pluginId).toBe('test-plugin')
  })

  it('deduplicates skills with the same basename (first wins)', () => {
    const pluginDir = tempDir('plugin')
    const a = join(pluginDir, 'a', 'dup')
    const b = join(pluginDir, 'b', 'dup')
    mkdirSync(a, { recursive: true })
    mkdirSync(b, { recursive: true })

    const m = makeManifest({ skills: [a, b] })
    const r = synthesizePlugin(m)

    expect(r.skills).toHaveLength(1)
    expect(r.skills[0].id).toBe('dup')
    expect(r.skills[0].dir).toBe(a) // first occurrence kept
  })

  it('handles skills: undefined', () => {
    const m = makeManifest({ skills: undefined })
    const r = synthesizePlugin(m)
    expect(r.skills).toEqual([])
  })
})

// ─── MCP servers — inline array ─────────────────────────────────────────

describe('synthesizePlugin — mcpServers inline', () => {
  const mcpConfig: McpServerConfig = {
    id: 'mcp-1',
    name: 'My MCP Server',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    enabled: true,
  }

  it('synthesizes inline MCP server configs with pluginId', () => {
    const m = makeManifest({ mcpServers: [mcpConfig] })
    const r = synthesizePlugin(m)

    expect(r.mcpServers).toHaveLength(1)
    expect(r.mcpServers[0]).toEqual<SynthesizedMcpEntry>({
      config: { ...mcpConfig, pluginId: 'test-plugin' },
      pluginId: 'test-plugin',
    })
  })

  it('synthesizes multiple inline MCP server configs', () => {
    const c2: McpServerConfig = { ...mcpConfig, id: 'mcp-2', name: 'Second' }
    const m = makeManifest({ mcpServers: [mcpConfig, c2] })
    const r = synthesizePlugin(m)

    expect(r.mcpServers).toHaveLength(2)
    expect(r.mcpServers[0].config.id).toBe('mcp-1')
    expect(r.mcpServers[1].config.id).toBe('mcp-2')
  })

  it('deduplicates inline MCP configs by id (first wins)', () => {
    const dup: McpServerConfig = { ...mcpConfig, id: 'mcp-1', name: 'Duplicate' }
    const m = makeManifest({ mcpServers: [mcpConfig, dup] })
    const r = synthesizePlugin(m)

    expect(r.mcpServers).toHaveLength(1)
    expect(r.mcpServers[0].config.name).toBe('My MCP Server')
  })

  it('skips MCP configs with missing id', () => {
    const bad: McpServerConfig = { id: '', name: 'Bad', transport: 'stdio', enabled: true }
    const m = makeManifest({ mcpServers: [bad, mcpConfig] })
    const r = synthesizePlugin(m)

    expect(r.mcpServers).toHaveLength(1)
    expect(r.mcpServers[0].config.id).toBe('mcp-1')
  })

  it('handles mcpServers: undefined', () => {
    const m = makeManifest({ mcpServers: undefined })
    const r = synthesizePlugin(m)
    expect(r.mcpServers).toEqual([])
  })
})

// ─── MCP servers — external file ────────────────────────────────────────

describe('synthesizePlugin — mcpServers external file', () => {
  const mcpConfig: McpServerConfig = {
    id: 'ext-mcp-1',
    name: 'External MCP',
    transport: 'sse',
    url: 'http://localhost:8080',
    enabled: true,
  }

  it('reads mcpServers from an external JSON file (servers wrapper)', () => {
    const pluginDir = tempDir('plugin')
    makeFile(pluginDir, 'mcp.json', JSON.stringify({ servers: [mcpConfig] }))
    const m = makeManifest({ mcpServers: resolve(pluginDir, 'mcp.json') })
    const r = synthesizePlugin(m)

    expect(r.mcpServers).toHaveLength(1)
    expect(r.mcpServers[0].config.id).toBe('ext-mcp-1')
    expect(r.mcpServers[0].pluginId).toBe('test-plugin')
  })

  it('reads mcpServers from an external JSON file (plain array)', () => {
    const pluginDir = tempDir('plugin')
    makeFile(pluginDir, 'mcp-arr.json', JSON.stringify([mcpConfig]))
    const m = makeManifest({ mcpServers: resolve(pluginDir, 'mcp-arr.json') })
    const r = synthesizePlugin(m)

    expect(r.mcpServers).toHaveLength(1)
    expect(r.mcpServers[0].config.id).toBe('ext-mcp-1')
  })

  it('returns empty when external file is missing', () => {
    const m = makeManifest({ mcpServers: '/nonexistent/mcp.json' })
    const r = synthesizePlugin(m)
    expect(r.mcpServers).toEqual([])
  })

  it('returns empty when external file is invalid JSON', () => {
    const pluginDir = tempDir('plugin')
    makeFile(pluginDir, 'bad.json', '{ not json }')
    const m = makeManifest({ mcpServers: resolve(pluginDir, 'bad.json') })
    const r = synthesizePlugin(m)
    expect(r.mcpServers).toEqual([])
  })

  it('deduplicates external MCP configs by id', () => {
    const pluginDir = tempDir('plugin')
    const dup: McpServerConfig = { ...mcpConfig, name: 'Duplicate' }
    makeFile(pluginDir, 'mcp-dup.json', JSON.stringify({ servers: [mcpConfig, dup] }))
    const m = makeManifest({ mcpServers: resolve(pluginDir, 'mcp-dup.json') })
    const r = synthesizePlugin(m)

    expect(r.mcpServers).toHaveLength(1)
    expect(r.mcpServers[0].config.name).toBe('External MCP')
  })
})

// ─── Agents — inline array ──────────────────────────────────────────────

describe('synthesizePlugin — agents inline', () => {
  const agentConfig: AgentConfig = {
    id: 'agent-1',
    name: 'My Agent',
    kind: 'custom',
    command: './agent',
    args: [],
    enabled: true,
  }

  it('synthesizes inline agent configs with pluginId', () => {
    const m = makeManifest({ agents: [agentConfig] })
    const r = synthesizePlugin(m)

    expect(r.agents).toHaveLength(1)
    expect(r.agents[0]).toEqual<SynthesizedAgentEntry>({
      config: agentConfig,
      pluginId: 'test-plugin',
    })
  })

  it('synthesizes multiple inline agent configs', () => {
    const a2: AgentConfig = { ...agentConfig, id: 'agent-2', name: 'Second' }
    const m = makeManifest({ agents: [agentConfig, a2] })
    const r = synthesizePlugin(m)

    expect(r.agents).toHaveLength(2)
    expect(r.agents[0].config.id).toBe('agent-1')
    expect(r.agents[1].config.id).toBe('agent-2')
  })

  it('deduplicates inline agent configs by id (first wins)', () => {
    const dup: AgentConfig = { ...agentConfig, id: 'agent-1', name: 'Duplicate' }
    const m = makeManifest({ agents: [agentConfig, dup] })
    const r = synthesizePlugin(m)

    expect(r.agents).toHaveLength(1)
    expect(r.agents[0].config.name).toBe('My Agent')
  })

  it('skips agent configs with missing id', () => {
    const bad: AgentConfig = { id: '', name: 'Bad', kind: 'custom', command: '', args: [], enabled: true }
    const m = makeManifest({ agents: [bad, agentConfig] })
    const r = synthesizePlugin(m)

    expect(r.agents).toHaveLength(1)
    expect(r.agents[0].config.id).toBe('agent-1')
  })

  it('handles agents: undefined', () => {
    const m = makeManifest({ agents: undefined })
    const r = synthesizePlugin(m)
    expect(r.agents).toEqual([])
  })
})

// ─── Agents — external file ─────────────────────────────────────────────

describe('synthesizePlugin — agents external file', () => {
  const agentConfig: AgentConfig = {
    id: 'ext-agent-1',
    name: 'External Agent',
    kind: 'internal',
    command: '',
    args: [],
    prompt: 'You are helpful.',
    enabled: true,
  }

  it('reads agents from an external JSON file (agents wrapper)', () => {
    const pluginDir = tempDir('plugin')
    makeFile(pluginDir, 'agents.json', JSON.stringify({ agents: [agentConfig] }))
    const m = makeManifest({ agents: resolve(pluginDir, 'agents.json') })
    const r = synthesizePlugin(m)

    expect(r.agents).toHaveLength(1)
    expect(r.agents[0].config.id).toBe('ext-agent-1')
    expect(r.agents[0].pluginId).toBe('test-plugin')
  })

  it('reads agents from an external JSON file (plain array)', () => {
    const pluginDir = tempDir('plugin')
    makeFile(pluginDir, 'agents-arr.json', JSON.stringify([agentConfig]))
    const m = makeManifest({ agents: resolve(pluginDir, 'agents-arr.json') })
    const r = synthesizePlugin(m)

    expect(r.agents).toHaveLength(1)
    expect(r.agents[0].config.id).toBe('ext-agent-1')
  })

  it('returns empty when external file is missing', () => {
    const m = makeManifest({ agents: '/nonexistent/agents.json' })
    const r = synthesizePlugin(m)
    expect(r.agents).toEqual([])
  })

  it('returns empty when external file is invalid JSON', () => {
    const pluginDir = tempDir('plugin')
    makeFile(pluginDir, 'bad-agents.json', 'not json')
    const m = makeManifest({ agents: resolve(pluginDir, 'bad-agents.json') })
    const r = synthesizePlugin(m)
    expect(r.agents).toEqual([])
  })

  it('deduplicates external agent configs by id', () => {
    const pluginDir = tempDir('plugin')
    const dup: AgentConfig = { ...agentConfig, name: 'Duplicate' }
    makeFile(pluginDir, 'agents-dup.json', JSON.stringify({ agents: [agentConfig, dup] }))
    const m = makeManifest({ agents: resolve(pluginDir, 'agents-dup.json') })
    const r = synthesizePlugin(m)

    expect(r.agents).toHaveLength(1)
    expect(r.agents[0].config.name).toBe('External Agent')
  })
})

// ─── Hooks — CJS file (happy path) ─────────────────────────────────────

describe('synthesizePlugin — hooks from CJS file', () => {
  it('synthesizes hooks from a CJS file with default export of Hook[]', () => {
    const pluginDir = tempDir('plugin')
    const hooksPath = makeFile(
      pluginDir,
      'hooks.cjs',
      [
        'module.exports = [',
        '  {',
        '    event: "TurnStart",',
        '    handler: async (ctx) => ({ kind: "allow" })',
        '  },',
        '  {',
        '    event: "PreToolUse",',
        '    matcher: "Bash",',
        '    handler: async (ctx) => ({ kind: "deny", reason: "blocked" })',
        '  },',
        ']',
      ].join('\n'),
    )

    const m = makeManifest({ hooks: resolve(pluginDir, hooksPath) })
    const r = synthesizePlugin(m)

    expect(r.hooks).toHaveLength(1)
    expect(r.hooks[0].pluginId).toBe('test-plugin')
    expect(r.hooks[0].hooks).toHaveLength(2)
    expect(r.hooks[0].hooks[0].event).toBe('TurnStart')
    expect(typeof r.hooks[0].hooks[0].handler).toBe('function')
    expect(r.hooks[0].hooks[1].event).toBe('PreToolUse')
    expect(r.hooks[0].hooks[1].matcher).toBe('Bash')
    expect(typeof r.hooks[0].hooks[1].handler).toBe('function')
  })

  it('synthesizes hooks with all fields present', () => {
    const pluginDir = tempDir('plugin')
    const hooksPath = makeFile(
      pluginDir,
      'hooks-full.cjs',
      [
        'module.exports = [',
        '  {',
        '    event: "PostToolUse",',
        '    matcher: "read_file",',
        '    handler: async (ctx) => ({ kind: "modify", modifiedInput: { path: ctx.toolInput?.path } })',
        '  },',
        ']',
      ].join('\n'),
    )

    const m = makeManifest({ hooks: resolve(pluginDir, hooksPath) })
    const r = synthesizePlugin(m)

    expect(r.hooks).toHaveLength(1)
    expect(r.hooks[0].hooks).toHaveLength(1)
    expect(r.hooks[0].hooks[0].event).toBe('PostToolUse')
    expect(r.hooks[0].hooks[0].matcher).toBe('read_file')
    expect(typeof r.hooks[0].hooks[0].handler).toBe('function')
  })
})

// ─── Hooks — missing file ──────────────────────────────────────────────

describe('synthesizePlugin — hooks missing file', () => {
  it('returns empty hooks array when the CJS file does not exist', () => {
    const m = makeManifest({ hooks: '/nonexistent/hooks.cjs' })
    const r = synthesizePlugin(m)
    expect(r.hooks).toEqual([])
  })

  it('returns empty hooks when the CJS file is not valid JS', () => {
    const pluginDir = tempDir('plugin')
    const hooksPath = makeFile(pluginDir, 'bad-hooks.cjs', 'this is not valid javascript {{{')
    const m = makeManifest({ hooks: resolve(pluginDir, hooksPath) })
    const r = synthesizePlugin(m)
    expect(r.hooks).toEqual([])
  })
})

// ─── Hooks — invalid entries ───────────────────────────────────────────

describe('synthesizePlugin — hooks invalid entries', () => {
  it('skips hooks with invalid event string (not a HookEvent)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pluginDir = tempDir('plugin')
    const hooksPath = makeFile(
      pluginDir,
      'bad-event.cjs',
      [
        'module.exports = [',
        '  {',
        '    event: "TurnStart",',
        '    handler: async (ctx) => ({ kind: "allow" })',
        '  },',
        '  {',
        '    event: "NotAHookEvent",',
        '    handler: async (ctx) => ({ kind: "allow" })',
        '  },',
        ']',
      ].join('\n'),
    )

    const m = makeManifest({ hooks: resolve(pluginDir, hooksPath) })
    const r = synthesizePlugin(m)

    expect(r.hooks).toHaveLength(1)
    expect(r.hooks[0].hooks).toHaveLength(1)
    expect(r.hooks[0].hooks[0].event).toBe('TurnStart')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('skips hooks with non-function handler', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pluginDir = tempDir('plugin')
    const hooksPath = makeFile(
      pluginDir,
      'bad-handler.cjs',
      [
        'module.exports = [',
        '  {',
        '    event: "TurnStart",',
        '    handler: "not a function"',
        '  },',
        '  {',
        '    event: "TurnComplete",',
        '    handler: async (ctx) => ({ kind: "allow" })',
        '  },',
        ']',
      ].join('\n'),
    )

    const m = makeManifest({ hooks: resolve(pluginDir, hooksPath) })
    const r = synthesizePlugin(m)

    expect(r.hooks).toHaveLength(1)
    expect(r.hooks[0].hooks).toHaveLength(1)
    expect(r.hooks[0].hooks[0].event).toBe('TurnComplete')
    expect(typeof r.hooks[0].hooks[0].handler).toBe('function')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('skips entries without event field', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pluginDir = tempDir('plugin')
    const hooksPath = makeFile(
      pluginDir,
      'no-event.cjs',
      [
        'module.exports = [',
        '  {',
        '    handler: async (ctx) => ({ kind: "allow" })',
        '  },',
        '  {',
        '    event: "SessionStart",',
        '    handler: async (ctx) => ({ kind: "allow" })',
        '  },',
        ']',
      ].join('\n'),
    )

    const m = makeManifest({ hooks: resolve(pluginDir, hooksPath) })
    const r = synthesizePlugin(m)

    expect(r.hooks).toHaveLength(1)
    expect(r.hooks[0].hooks).toHaveLength(1)
    expect(r.hooks[0].hooks[0].event).toBe('SessionStart')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

// ─── Hooks — inline array (warning, empty result) ──────────────────────

describe('synthesizePlugin — hooks inline array', () => {
  it('logs warning and returns empty for inline Hook[] arrays', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = makeManifest({
      hooks: [
        { event: 'TurnStart', handler: async () => ({ kind: 'allow' }) },
      ],
    })
    const r = synthesizePlugin(m)

    expect(r.hooks).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('inline'))
    warnSpy.mockRestore()
  })

  it('logs warning and returns empty for empty inline Hook[] array', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = makeManifest({ hooks: [] })
    const r = synthesizePlugin(m)

    expect(r.hooks).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('inline'))
    warnSpy.mockRestore()
  })
})

// ─── Hooks — undefined ─────────────────────────────────────────────────

describe('synthesizePlugin — hooks undefined', () => {
  it('returns empty hooks array when hooks is undefined', () => {
    const m = makeManifest({ hooks: undefined })
    const r = synthesizePlugin(m)
    expect(r.hooks).toEqual([])
  })
})

// ─── Full manifest ──────────────────────────────────────────────────────

describe('synthesizePlugin — full manifest', () => {
  it('synthesizes all three component types from one manifest', () => {
    const pluginDir = tempDir('plugin')
    const skillDir = join(pluginDir, 'skills', 'full-skill')
    mkdirSync(skillDir, { recursive: true })

    const mcp: McpServerConfig = {
      id: 'mcp-full',
      name: 'Full MCP',
      transport: 'stdio',
      command: 'node',
      args: ['srv.js'],
      enabled: true,
    }
    const agent: AgentConfig = {
      id: 'agent-full',
      name: 'Full Agent',
      kind: 'internal',
      command: '',
      args: [],
      prompt: 'Hello.',
      enabled: true,
    }

    const m = makeManifest({
      skills: skillDir,
      mcpServers: [mcp],
      agents: [agent],
    })
    const r = synthesizePlugin(m)

    expect(r.pluginId).toBe('test-plugin')
    expect(r.skills).toHaveLength(1)
    expect(r.skills[0].id).toBe('full-skill')
    expect(r.mcpServers).toHaveLength(1)
    expect(r.mcpServers[0].config.id).toBe('mcp-full')
    expect(r.agents).toHaveLength(1)
    expect(r.agents[0].config.id).toBe('agent-full')
    expect(r.hooks).toEqual([])
  })

  it('pluginId matches the manifest id (not name)', () => {
    const m = makeManifest({ id: 'actual-id', name: 'Display Name' })
    const r = synthesizePlugin(m)
    expect(r.pluginId).toBe('actual-id')
  })
})
