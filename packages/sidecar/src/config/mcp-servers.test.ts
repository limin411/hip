import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpServerConfig } from '@hip/protocol'
import { readMcpServersConfig } from './mcp-servers.js'

const tmps: string[] = []
function writeFile(name: string, obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'hip-mcp-')); tmps.push(dir)
  const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
  delete process.env.HIP_MCP_SERVERS_PATH
})

const stdioServer: McpServerConfig = {
  id: 's1', name: 'Local', transport: 'stdio', command: 'node', args: ['server.js'], enabled: true,
}
const httpServer: McpServerConfig = {
  id: 's2', name: 'Remote', transport: 'http', url: 'https://example.test/mcp', enabled: false,
}

describe('readMcpServersConfig', () => {
  it('returns [] when HIP_MCP_SERVERS_PATH is unset', () => {
    delete process.env.HIP_MCP_SERVERS_PATH
    expect(readMcpServersConfig()).toEqual([])
  })
  it('reads the servers array from the file', () => {
    process.env.HIP_MCP_SERVERS_PATH = writeFile('hip-mcp-servers.json', { servers: [stdioServer, httpServer] })
    expect(readMcpServersConfig()).toEqual([stdioServer, httpServer])
  })
  it('returns [] when servers is missing or not an array', () => {
    process.env.HIP_MCP_SERVERS_PATH = writeFile('hip-mcp-servers.json', { servers: 'nope' })
    expect(readMcpServersConfig()).toEqual([])
  })
  it('returns [] on a corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-mcp-')); tmps.push(dir)
    const p = join(dir, 'hip-mcp-servers.json'); writeFileSync(p, '{ not json'); process.env.HIP_MCP_SERVERS_PATH = p
    expect(readMcpServersConfig()).toEqual([])
  })
})
