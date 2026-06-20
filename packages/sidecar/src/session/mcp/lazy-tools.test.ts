import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpServerConfig } from '@hip/protocol'
import { McpManager, type ClientLike, DEFAULT_LAZY_THRESHOLD } from './manager.js'

class FakeClient implements ClientLike {
  closed = false
  callArgs: Array<{ name: string; arguments?: Record<string, unknown> }> = []
  constructor(
    private readonly toolList: Array<{ name: string; description?: string; inputSchema?: unknown }>,
    private readonly callResult: unknown = { content: [{ type: 'text', text: 'ok' }] },
  ) {}
  async listTools() { return { tools: this.toolList } }
  async callTool(req: { name: string; arguments?: Record<string, unknown> }) { this.callArgs.push(req); return this.callResult }
  async close() { this.closed = true }
}

class TestManager extends McpManager {
  connectCount = 0
  lastClients = new Map<string, FakeClient>()
  toolsById: Record<string, Array<{ name: string; description?: string; inputSchema?: unknown }>> = {}

  protected async connect(server: McpServerConfig): Promise<ClientLike> {
    this.connectCount++
    const client = new FakeClient(this.toolsById[server.id] ?? [{ name: 'do_thing' }])
    this.lastClients.set(server.id, client)
    return client
  }
}

const stdio = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 's1', name: 'S1', transport: 'stdio', command: 'node', args: ['a.js'], enabled: true, ...over,
})

function makeTools(count: number, prefix = 'tool'): Array<{ name: string; description?: string }> {
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}_${i}`,
    description: `Description for ${prefix}_${i}`,
  }))
}

let mgr: TestManager
beforeEach(() => { mgr = new TestManager(); vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('McpManager lazy tool loading', () => {
  it('returns all tools directly when count < threshold', async () => {
    mgr.toolsById = { s1: makeTools(5) }
    await mgr.reconcile([stdio({ id: 's1' })])
    const t = mgr.tools({ lazyThreshold: DEFAULT_LAZY_THRESHOLD })
    expect(t.length).toBe(5)
    expect(t.map((x) => x.name)).toEqual([
      'mcp__s1__tool_0', 'mcp__s1__tool_1', 'mcp__s1__tool_2', 'mcp__s1__tool_3', 'mcp__s1__tool_4',
    ])
  })

  it('returns proxy tools (mcp_search + mcp_invoke) when count >= threshold', async () => {
    mgr.toolsById = { s1: makeTools(DEFAULT_LAZY_THRESHOLD) }
    await mgr.reconcile([stdio({ id: 's1' })])
    const t = mgr.tools({ lazyThreshold: DEFAULT_LAZY_THRESHOLD })
    const names = t.map((x) => x.name).sort()
    expect(names).toEqual(['mcp_invoke', 'mcp_search'])
  })

  it('respects custom threshold', async () => {
    mgr.toolsById = { s1: makeTools(5) }
    await mgr.reconcile([stdio({ id: 's1' })])
    const t = mgr.tools({ lazyThreshold: 3 })
    const names = t.map((x) => x.name).sort()
    expect(names).toEqual(['mcp_invoke', 'mcp_search'])
  })

  it('returns all tools when lazyThreshold is Infinity', async () => {
    mgr.toolsById = { s1: makeTools(50) }
    await mgr.reconcile([stdio({ id: 's1' })])
    const t = mgr.tools({ lazyThreshold: Infinity })
    expect(t.length).toBe(50)
  })

  it('returns proxy tools when lazyThreshold is 0 (force lazy)', async () => {
    mgr.toolsById = { s1: makeTools(1) }
    await mgr.reconcile([stdio({ id: 's1' })])
    const t = mgr.tools({ lazyThreshold: 0 })
    const names = t.map((x) => x.name).sort()
    expect(names).toEqual(['mcp_invoke', 'mcp_search'])
  })

  it('returns empty when no servers connected', () => {
    expect(mgr.tools({ lazyThreshold: DEFAULT_LAZY_THRESHOLD })).toEqual([])
  })
})

describe('mcp_search tool', () => {
  it('searches tool names by keyword', async () => {
    mgr.toolsById = {
      s1: [
        { name: 'read_file', description: 'Read a file' },
        { name: 'write_file', description: 'Write a file' },
        { name: 'list_dir', description: 'List directory' },
      ],
    }
    await mgr.reconcile([stdio({ id: 's1' })])
    const searchTool = mgr.tools({ lazyThreshold: 3 }).find((t) => t.name === 'mcp_search')!
    const result = String(await searchTool.invoke({ query: 'read' }))
    expect(result).toContain('mcp__s1__read_file')
    expect(result).not.toContain('mcp__s1__write_file')
  })

  it('searches tool descriptions by keyword', async () => {
    mgr.toolsById = {
      s1: [
        { name: 'alpha', description: 'Processes images for the user' },
        { name: 'beta', description: 'Handles text processing' },
      ],
    }
    await mgr.reconcile([stdio({ id: 's1' })])
    const searchTool = mgr.tools({ lazyThreshold: 2 }).find((t) => t.name === 'mcp_search')!
    const result = String(await searchTool.invoke({ query: 'image' }))
    expect(result).toContain('mcp__s1__alpha')
    expect(result).not.toContain('mcp__s1__beta')
  })

  it('returns empty message for no matches', async () => {
    mgr.toolsById = { s1: [{ name: 'tool_a' }] }
    await mgr.reconcile([stdio({ id: 's1' })])
    const searchTool = mgr.tools({ lazyThreshold: 1 }).find((t) => t.name === 'mcp_search')!
    const result = String(await searchTool.invoke({ query: 'nonexistent' }))
    expect(result).toContain('No MCP tools match')
  })
})

describe('mcp_invoke proxy tool', () => {
  it('invokes a tool by serverId + toolName', async () => {
    mgr.toolsById = { s1: [{ name: 'echo', description: 'Echo input' }] }
    await mgr.reconcile([stdio({ id: 's1' })])
    const invokeTool = mgr.tools({ lazyThreshold: 1 }).find((t) => t.name === 'mcp_invoke')!
    const result = String(await invokeTool.invoke({ serverId: 's1', toolName: 'echo', arguments: { msg: 'hello' } }))
    expect(result).toBe('ok')
    expect(mgr.lastClients.get('s1')!.callArgs).toEqual([{ name: 'echo', arguments: { msg: 'hello' } }])
  })

  it('returns error for unknown server', async () => {
    mgr.toolsById = { s1: [{ name: 'echo' }] }
    await mgr.reconcile([stdio({ id: 's1' })])
    const invokeTool = mgr.tools({ lazyThreshold: 1 }).find((t) => t.name === 'mcp_invoke')!
    const result = String(await invokeTool.invoke({ serverId: 'unknown', toolName: 'echo', arguments: {} }))
    expect(result).toContain('not connected')
    expect(result).toContain('s1')
  })

  it('returns error for unknown tool on valid server', async () => {
    mgr.toolsById = { s1: [{ name: 'echo' }] }
    await mgr.reconcile([stdio({ id: 's1' })])
    const invokeTool = mgr.tools({ lazyThreshold: 1 }).find((t) => t.name === 'mcp_invoke')!
    const result = String(await invokeTool.invoke({ serverId: 's1', toolName: 'bogus', arguments: {} }))
    expect(result).toContain('not found')
  })
})

describe('toolCatalog', () => {
  it('contains server names and tool counts', async () => {
    mgr.toolsById = { s1: makeTools(3), s2: makeTools(5, 'fn') }
    await mgr.reconcile([stdio({ id: 's1', name: 'Files' }), stdio({ id: 's2', name: 'Database' })])
    const catalog = mgr.toolCatalog()
    expect(catalog).toContain('Files (3 tools)')
    expect(catalog).toContain('Database (5 tools)')
    expect(catalog).toContain('<available-mcp-tools>')
    expect(catalog).toContain('</available-mcp-tools>')
  })

  it('returns empty string when no tools', () => {
    expect(mgr.toolCatalog()).toBe('')
  })
})

describe('toolDetailCatalog', () => {
  it('lists all tool names grouped by server', async () => {
    mgr.toolsById = { s1: [{ name: 'read', description: 'Read file' }] }
    await mgr.reconcile([stdio({ id: 's1' })])
    const detail = mgr.toolDetailCatalog()
    expect(detail).toContain('mcp__s1__read')
    expect(detail).toContain('Read file')
  })

  it('filters by keyword', async () => {
    mgr.toolsById = {
      s1: [{ name: 'read', description: 'Read' }, { name: 'write', description: 'Write' }],
    }
    await mgr.reconcile([stdio({ id: 's1' })])
    const detail = mgr.toolDetailCatalog('read')
    expect(detail).toContain('mcp__s1__read')
    expect(detail).not.toContain('mcp__s1__write')
  })
})

describe('toolCount and toolCounts', () => {
  it('counts all tools across servers', async () => {
    mgr.toolsById = { s1: makeTools(3), s2: makeTools(2) }
    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    expect(mgr.toolCount()).toBe(5)
  })

  it('toolCounts returns per-server breakdown', async () => {
    mgr.toolsById = { s1: makeTools(3), s2: makeTools(0) }
    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    const counts = mgr.toolCounts()
    expect(counts).toHaveLength(1) // s2 has 0 tools, skipped
    expect(counts[0].serverId).toBe('s1')
    expect(counts[0].count).toBe(3)
  })
})
