import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpServerConfig } from '@hip/protocol'
import { McpManager, type ClientLike, DEFAULT_LAZY_THRESHOLD } from './mcp/manager.js'
import { ToolRegistry, createScope } from './tool-registry.js'

/** A Fake MCP client: records calls, returns a fixed tool list, never touches the network. */
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

/** A test manager that injects Fake clients instead of spawning processes / opening sockets. */
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

describe('McpManager ToolRegistry scope lifecycle', () => {
  // ── 1. MCP connect → tools registered in ToolRegistry ─────────────────────
  it('registers connected MCP tools into a ToolRegistry scope', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }, { name: 'fetch' }] }
    await mgr.reconcile([stdio({ id: 's1' })])

    const registry = new ToolRegistry()
    const scope = createScope()
    mgr.registerWithRegistry(registry, scope)

    expect(registry.size).toBe(2)
    const names = registry.materialize().definitions.map((d) => d.name).sort()
    expect(names).toEqual(['mcp__s1__fetch', 'mcp__s1__search'])
  })

  // ── 2. MCP disconnect → tools unregistered via scope close ────────────────
  it('unregisters all MCP tools when the server disconnects', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }, { name: 'fetch' }] }
    await mgr.reconcile([stdio({ id: 's1' })])

    const registry = new ToolRegistry()
    const scope = createScope()
    mgr.registerWithRegistry(registry, scope)
    expect(registry.size).toBe(2)

    await mgr.reconcile([])

    expect(registry.size).toBe(0)
    expect(registry.materialize().definitions).toEqual([])
  })

  // ── 3. stale tool call after disconnect → stale error from ToolRegistry ───
  it('rejects stale tool calls after the MCP server disconnects', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    await mgr.reconcile([stdio({ id: 's1' })])

    const registry = new ToolRegistry()
    const scope = createScope()
    mgr.registerWithRegistry(registry, scope)

    const materialization = registry.materialize()
    expect(materialization.definitions).toHaveLength(1)

    await mgr.reconcile([])

    const result = await materialization.settle({
      name: 'mcp__s1__search',
      callId: 'call-1',
      args: {},
    })

    expect(result.content).toBe('Tool registration changed after materialization')
    expect(result.tool_call_id).toBe('call-1')
    expect(result.name).toBe('mcp__s1__search')
  })

  // ── 4. lazy threshold still works (tools() returns proxy tools when over threshold)
  it('keeps lazy threshold behavior through the registry path', async () => {
    mgr.toolsById = { s1: makeTools(DEFAULT_LAZY_THRESHOLD) }
    await mgr.reconcile([stdio({ id: 's1' })])

    const registry = new ToolRegistry()
    const scope = createScope()
    mgr.registerWithRegistry(registry, scope)

    // Registry reflects the lazy proxy set, not the full individual tool list.
    const names = registry.materialize().definitions.map((d) => d.name).sort()
    expect(names).toEqual(['mcp_invoke', 'mcp_search'])

    // Direct tools() fallback also remains lazy.
    const directNames = mgr.tools().map((t) => t.name).sort()
    expect(directNames).toEqual(['mcp_invoke', 'mcp_search'])
  })

  // ── 5. reconnection → old scope closed, new scope opened, tools refreshed ─
  it('refreshes the scope when an MCP server reconnects', async () => {
    mgr.toolsById = { s1: [{ name: 'alpha' }] }
    await mgr.reconcile([stdio({ id: 's1' })])

    const registry = new ToolRegistry()
    const scope = createScope()
    mgr.registerWithRegistry(registry, scope)

    const before = registry.materialize()
    expect(before.definitions.map((d) => d.name)).toEqual(['mcp__s1__alpha'])

    // Change server config to force reconnect; new tool list replaces alpha with beta.
    mgr.toolsById = { s1: [{ name: 'beta' }] }
    await mgr.reconcile([stdio({ id: 's1', args: ['b.js'] })])

    // Old materialization is now stale.
    const stale = await before.settle({ name: 'mcp__s1__alpha', callId: 'call-old', args: {} })
    expect(stale.content).toBe('Tool registration changed after materialization')

    // New materialization sees the refreshed tool set.
    const after = registry.materialize()
    expect(after.definitions.map((d) => d.name)).toEqual(['mcp__s1__beta'])
  })
})
