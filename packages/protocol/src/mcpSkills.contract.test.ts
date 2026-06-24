import { describe, it, expect } from 'vitest'
import type {
  McpTransport,
  McpServerConfig,
  SkillMeta,
  SkillsConfig,
  ClientMessage,
  ServerMessage,
} from './index.js'

describe('protocol: MCP server types', () => {
  it('accepts all three transports', () => {
    const transports: McpTransport[] = ['stdio', 'sse', 'http']
    expect(transports).toEqual(['stdio', 'sse', 'http'])
  })

  it('models a stdio server (command/args/env)', () => {
    const server: McpServerConfig = {
      id: 'srv-1',
      name: 'Local files',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { FOO: 'bar' },
      enabled: true,
    }
    const round = JSON.parse(JSON.stringify(server)) as McpServerConfig
    expect(round.transport).toBe('stdio')
    expect(round.command).toBe('npx')
    expect(round.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp'])
    expect(round.env).toEqual({ FOO: 'bar' })
    expect(round.enabled).toBe(true)
  })

  it('models an sse/http server (url/headers)', () => {
    const server: McpServerConfig = {
      id: 'srv-2',
      name: 'Remote',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer x' },
      enabled: false,
    }
    const round = JSON.parse(JSON.stringify(server)) as McpServerConfig
    expect(round.transport).toBe('http')
    expect(round.url).toBe('https://example.com/mcp')
    expect(round.headers).toEqual({ Authorization: 'Bearer x' })
    expect(round.enabled).toBe(false)
  })

})

describe('protocol: Skill types', () => {
  it('models SkillMeta', () => {
    const meta: SkillMeta = {
      id: 'pdf-tools',
      name: 'PDF Tools',
      description: 'Read and edit PDFs',
      dir: '/Users/me/.hip/skills/pdf-tools',
      hasScripts: true,
    }
    const round = JSON.parse(JSON.stringify(meta)) as SkillMeta
    expect(round.id).toBe('pdf-tools')
    expect(round.name).toBe('PDF Tools')
    expect(round.description).toBe('Read and edit PDFs')
    expect(round.dir).toBe('/Users/me/.hip/skills/pdf-tools')
    expect(round.hasScripts).toBe(true)
  })

  it('models SkillsConfig enabled map (missing id => enabled)', () => {
    const cfg: SkillsConfig = { enabled: { 'pdf-tools': false } }
    expect(cfg.enabled['pdf-tools']).toBe(false)
    // a missing id is treated as enabled at the read sites; the type only stores explicit overrides
    expect(cfg.enabled['other']).toBeUndefined()
  })
})

// ──────────────────────────────────────────────────────────────────
// Plugin install ClientMessage/ServerMessage variants
// ──────────────────────────────────────────────────────────────────

describe('protocol: plugin install messages', () => {
  it('plugin:install:url ClientMessage round-trips', () => {
    const m: ClientMessage = {
      type: 'plugin:install:url',
      url: 'https://github.com/example/plugin.git',
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ClientMessage, { type: 'plugin:install:url' }>
    expect(rt.type).toBe('plugin:install:url')
    expect(rt.url).toBe('https://github.com/example/plugin.git')
  })

  it('plugin:install:progress ServerMessage round-trips (cloning)', () => {
    const m: ServerMessage = {
      type: 'plugin:install:progress',
      status: 'cloning',
      message: 'Cloning repository...',
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'plugin:install:progress' }>
    expect(rt.type).toBe('plugin:install:progress')
    expect(rt.status).toBe('cloning')
    expect(rt.message).toBe('Cloning repository...')
  })

  it('plugin:install:progress ServerMessage round-trips (done with components)', () => {
    const m: ServerMessage = {
      type: 'plugin:install:progress',
      status: 'done',
      message: 'Install complete',
      pluginId: 'my-plugin',
      components: { skills: 2, mcpServers: 1, agents: 0, hooks: 3 },
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'plugin:install:progress' }>
    expect(rt.status).toBe('done')
    expect(rt.pluginId).toBe('my-plugin')
    expect(rt.components).toEqual({ skills: 2, mcpServers: 1, agents: 0, hooks: 3 })
  })

  it('plugin:install:progress ServerMessage round-trips (error)', () => {
    const m: ServerMessage = {
      type: 'plugin:install:progress',
      status: 'error',
      message: 'Clone failed: network error',
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'plugin:install:progress' }>
    expect(rt.status).toBe('error')
    expect(rt.message).toBe('Clone failed: network error')
  })

  it('plugin:install:result ServerMessage round-trips (success)', () => {
    const m: ServerMessage = {
      type: 'plugin:install:result',
      ok: true,
      pluginId: 'my-plugin',
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'plugin:install:result' }>
    expect(rt.type).toBe('plugin:install:result')
    expect(rt.ok).toBe(true)
    expect(rt.pluginId).toBe('my-plugin')
  })

  it('plugin:install:result ServerMessage round-trips (failure)', () => {
    const m: ServerMessage = {
      type: 'plugin:install:result',
      ok: false,
      error: 'Manifest validation failed',
    }
    const rt = JSON.parse(JSON.stringify(m)) as Extract<ServerMessage, { type: 'plugin:install:result' }>
    expect(rt.ok).toBe(false)
    expect(rt.error).toBe('Manifest validation failed')
    expect(rt.pluginId).toBeUndefined()
  })
})
