import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpServerConfig } from '@hip/protocol'
import { McpManager, type ClientLike } from './manager.js'

class FakeClient implements ClientLike {
  closed = false
  constructor(
    private readonly toolList: Array<{ name: string; description?: string; inputSchema?: unknown }>,
    private readonly callResult: unknown = { content: [{ type: 'text', text: 'ok' }] },
  ) {}
  async listTools() { return { tools: this.toolList } }
  async callTool() { return this.callResult }
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

function stdio(over: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 's1', name: 'S1', transport: 'stdio', command: 'node', args: ['a.js'], enabled: true, ...over,
  }
}

const allTools = [
  { name: 'tool_a', description: 'Tool A' },
  { name: 'tool_b', description: 'Tool B' },
  { name: 'tool_c', description: 'Tool C' },
  { name: 'tool_d', description: 'Tool D' },
]

let mgr: TestManager
beforeEach(() => { mgr = new TestManager(); vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('McpManager tool filtering (enabled/disabled)', () => {
  it('returns all tools when enabledTools is empty/undefined', async () => {
    mgr.toolsById = { s1: allTools }
    await mgr.reconcile([stdio({ id: 's1' })])
    const names = mgr.tools({ lazyThreshold: Infinity }).map((t) => t.name)
    expect(names).toEqual([
      'mcp__s1__tool_a', 'mcp__s1__tool_b', 'mcp__s1__tool_c', 'mcp__s1__tool_d',
    ])
  })

  it('filters by enabledTools (allowlist)', async () => {
    mgr.toolsById = { s1: allTools }
    await mgr.reconcile([stdio({ id: 's1', enabledTools: ['tool_a', 'tool_c'] })])
    const names = mgr.tools({ lazyThreshold: Infinity }).map((t) => t.name)
    expect(names).toEqual(['mcp__s1__tool_a', 'mcp__s1__tool_c'])
  })

  it('filters by disabledTools (denylist)', async () => {
    mgr.toolsById = { s1: allTools }
    await mgr.reconcile([stdio({ id: 's1', disabledTools: ['tool_b', 'tool_d'] })])
    const names = mgr.tools({ lazyThreshold: Infinity }).map((t) => t.name)
    expect(names).toEqual(['mcp__s1__tool_a', 'mcp__s1__tool_c'])
  })

  it('applies disabledTools after enabledTools', async () => {
    mgr.toolsById = { s1: allTools }
    await mgr.reconcile([stdio({ id: 's1', enabledTools: ['tool_a', 'tool_b', 'tool_c'], disabledTools: ['tool_b'] })])
    const names = mgr.tools({ lazyThreshold: Infinity }).map((t) => t.name)
    expect(names).toEqual(['mcp__s1__tool_a', 'mcp__s1__tool_c'])
  })

  it('empty enabledTools allows all (then deny removes)', async () => {
    mgr.toolsById = { s1: allTools }
    await mgr.reconcile([stdio({ id: 's1', disabledTools: ['tool_a'] })])
    const names = mgr.tools({ lazyThreshold: Infinity }).map((t) => t.name)
    expect(names).toEqual(['mcp__s1__tool_b', 'mcp__s1__tool_c', 'mcp__s1__tool_d'])
  })

  it('filtering works in lazy mode via mcp_search and mcp_invoke', async () => {
    mgr.toolsById = { s1: allTools }
    await mgr.reconcile([stdio({ id: 's1', enabledTools: ['tool_a', 'tool_b', 'tool_d'], disabledTools: ['tool_b'] })])
    // With lazyThreshold=0, we force lazy mode but filtering still applies
    const lazyTools = mgr.tools({ lazyThreshold: 0 })
    const names = lazyTools.map((t) => t.name).sort()
    expect(names).toEqual(['mcp_invoke', 'mcp_search'])

    // Search should only find filtered tools
    const searchTool = lazyTools.find((t) => t.name === 'mcp_search')!
    const result = String(await searchTool.invoke({ query: 'tool' }))
    expect(result).toContain('mcp__s1__tool_a')
    expect(result).toContain('mcp__s1__tool_d')
    expect(result).not.toContain('mcp__s1__tool_b')
    expect(result).not.toContain('mcp__s1__tool_c')
  })

  it('multiple servers with different filters', async () => {
    mgr.toolsById = {
      s1: allTools,
      s2: [{ name: 'find', description: 'Find things' }, { name: 'replace', description: 'Replace things' }],
    }
    await mgr.reconcile([
      stdio({ id: 's1', enabledTools: ['tool_a'] }),
      stdio({ id: 's2', disabledTools: ['replace'] }),
    ])
    const names = mgr.tools({ lazyThreshold: Infinity }).map((t) => t.name).sort()
    expect(names).toEqual(['mcp__s1__tool_a', 'mcp__s2__find'])
  })

  it('filtered tools affect lazy threshold calculation', async () => {
    // 4 tools, but only 1 is enabled → count=1 < threshold → pre-load mode
    mgr.toolsById = { s1: allTools }
    await mgr.reconcile([stdio({ id: 's1', enabledTools: ['tool_a'] })])
    const t = mgr.tools({ lazyThreshold: 2 })
    expect(t.length).toBe(1)
    expect(t[0].name).toBe('mcp__s1__tool_a')
  })

  it('filtered tools trigger lazy mode when count crosses threshold', async () => {
    mgr.toolsById = { s1: allTools }
    await mgr.reconcile([stdio({ id: 's1', enabledTools: ['tool_a', 'tool_b', 'tool_c'] })])
    const t = mgr.tools({ lazyThreshold: 3 })
    const names = t.map((x) => x.name).sort()
    expect(names).toEqual(['mcp_invoke', 'mcp_search'])
  })
})
