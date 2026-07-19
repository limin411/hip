import { describe, it, expect } from 'vitest'
import type { McpServerConfig } from '@hip/protocol'
import type { AcpAgentRuntimeCaps } from './acp-connection.js'
import { mapHipMcpToAcp } from './acp-mcp-map.js'

const capsAll: AcpAgentRuntimeCaps = {
  loadSession: true,
  closeSession: true,
  resumeSession: false,
  mcp: { http: true, sse: true },
}

const capsStdioOnly: AcpAgentRuntimeCaps = {
  loadSession: true,
  closeSession: true,
  resumeSession: false,
  mcp: { http: false, sse: false },
}

function stdio(partial: Partial<McpServerConfig> & { id: string }): McpServerConfig {
  return {
    name: partial.name ?? partial.id,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'srv'],
    enabled: true,
    ...partial,
  }
}

describe('mapHipMcpToAcp', () => {
  it('maps stdio with required name, command, args[], env[] (no type field)', () => {
    const mapped = mapHipMcpToAcp(
      [stdio({ id: 'fs', name: 'Filesystem', command: 'npx', args: ['-y', 'fs'], env: { FOO: 'bar' } })],
      capsAll,
    )
    expect(mapped).toEqual([
      {
        name: 'Filesystem',
        command: 'npx',
        args: ['-y', 'fs'],
        env: [{ name: 'FOO', value: 'bar' }],
      },
    ])
    expect(mapped[0]).not.toHaveProperty('type')
  })

  it('defaults missing args and env to empty arrays', () => {
    const mapped = mapHipMcpToAcp(
      [{ id: 'x', name: 'X', transport: 'stdio', command: 'echo', enabled: true }],
      capsAll,
    )
    expect(mapped).toEqual([{ name: 'X', command: 'echo', args: [], env: [] }])
  })

  it('maps http/sse with type+url+headers[] (headers default [])', () => {
    const servers: McpServerConfig[] = [
      {
        id: 'h1',
        name: 'HTTP MCP',
        transport: 'http',
        url: 'https://example.com/mcp',
        enabled: true,
      },
      {
        id: 's1',
        name: 'SSE MCP',
        transport: 'sse',
        url: 'https://example.com/sse',
        headers: { Authorization: 'Bearer t' },
        enabled: true,
      },
    ]
    const mapped = mapHipMcpToAcp(servers, capsAll)
    expect(mapped).toEqual([
      { type: 'http', name: 'HTTP MCP', url: 'https://example.com/mcp', headers: [] },
      {
        type: 'sse',
        name: 'SSE MCP',
        url: 'https://example.com/sse',
        headers: [{ name: 'Authorization', value: 'Bearer t' }],
      },
    ])
  })

  it('skips enabled === false', () => {
    const mapped = mapHipMcpToAcp(
      [stdio({ id: 'off', enabled: false }), stdio({ id: 'on' })],
      capsAll,
    )
    expect(mapped).toHaveLength(1)
    expect(mapped[0]!.name).toBe('on')
  })

  it('skips stdio without command and http/sse without url', () => {
    const mapped = mapHipMcpToAcp(
      [
        { id: 'no-cmd', name: 'NoCmd', transport: 'stdio', enabled: true },
        { id: 'no-url', name: 'NoUrl', transport: 'http', enabled: true },
        stdio({ id: 'ok' }),
      ],
      capsAll,
    )
    expect(mapped).toHaveLength(1)
    expect(mapped[0]!.name).toBe('ok')
  })

  it('filters http/sse when caps.mcp.http/sse are false', () => {
    const servers: McpServerConfig[] = [
      stdio({ id: 'local' }),
      { id: 'h', name: 'H', transport: 'http', url: 'https://x', enabled: true },
      { id: 's', name: 'S', transport: 'sse', url: 'https://y', enabled: true },
    ]
    const mapped = mapHipMcpToAcp(servers, capsStdioOnly)
    expect(mapped).toHaveLength(1)
    expect(mapped[0]).toMatchObject({ name: 'local', command: 'npx' })
  })

  it('falls back name to id when name is empty', () => {
    const mapped = mapHipMcpToAcp(
      [{ id: 'fallback-id', name: '  ', transport: 'stdio', command: 'echo', enabled: true }],
      capsAll,
    )
    expect(mapped[0]!.name).toBe('fallback-id')
  })

  it('respects allowServerIds when set', () => {
    const mapped = mapHipMcpToAcp(
      [stdio({ id: 'a' }), stdio({ id: 'b' }), stdio({ id: 'c' })],
      capsAll,
      { allowServerIds: ['b'] },
    )
    expect(mapped).toHaveLength(1)
    expect(mapped[0]!.name).toBe('b')
  })

  it('returns empty array for empty input', () => {
    expect(mapHipMcpToAcp([], capsAll)).toEqual([])
  })
})
