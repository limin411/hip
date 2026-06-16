import { describe, it, expect } from 'vitest'
import type {
  McpTransport,
  McpServerConfig,
  McpServersConfig,
  SkillMeta,
  SkillsConfig,
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

  it('wraps servers in McpServersConfig', () => {
    const cfg: McpServersConfig = { servers: [] }
    expect(cfg.servers).toEqual([])
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
