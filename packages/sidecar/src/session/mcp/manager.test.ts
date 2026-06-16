import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpServerConfig } from '@hip/protocol'
import { McpManager, type ClientLike } from './manager.js'

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
  failIds = new Set<string>()
  toolsById: Record<string, Array<{ name: string; description?: string; inputSchema?: unknown }>> = {}

  protected async connect(server: McpServerConfig): Promise<ClientLike> {
    this.connectCount++
    if (this.failIds.has(server.id)) throw new Error('connect boom')
    const client = new FakeClient(this.toolsById[server.id] ?? [{ name: 'do_thing' }])
    this.lastClients.set(server.id, client)
    return client
  }
}

const stdio = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 's1', name: 'S1', transport: 'stdio', command: 'node', args: ['a.js'], enabled: true, ...over,
})

let mgr: TestManager
beforeEach(() => { mgr = new TestManager(); vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('McpManager.reconcile', () => {
  it('connects newly-enabled servers and exposes their ids', async () => {
    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    expect(mgr.connectedIds()).toEqual(['s1', 's2'])
    expect(mgr.connectCount).toBe(2)
  })

  it('skips disabled servers', async () => {
    await mgr.reconcile([stdio({ id: 's1', enabled: false }), stdio({ id: 's2' })])
    expect(mgr.connectedIds()).toEqual(['s2'])
  })

  it('reuses an unchanged server without reconnecting', async () => {
    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.connectCount).toBe(1)
    await mgr.reconcile([stdio({ id: 's1' })]) // identical config
    expect(mgr.connectCount).toBe(1)            // not reconnected
    expect(mgr.connectedIds()).toEqual(['s1'])
  })

  it('disconnects servers that were removed', async () => {
    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    const c1 = mgr.lastClients.get('s1')!
    await mgr.reconcile([stdio({ id: 's2' })])
    expect(c1.closed).toBe(true)
    expect(mgr.connectedIds()).toEqual(['s2'])
  })

  it('disconnects servers that were disabled', async () => {
    await mgr.reconcile([stdio({ id: 's1' })])
    const c1 = mgr.lastClients.get('s1')!
    await mgr.reconcile([stdio({ id: 's1', enabled: false })])
    expect(c1.closed).toBe(true)
    expect(mgr.connectedIds()).toEqual([])
  })

  it('reconnects a server whose config changed (fingerprint differs)', async () => {
    await mgr.reconcile([stdio({ id: 's1', args: ['a.js'] })])
    const c1 = mgr.lastClients.get('s1')!
    await mgr.reconcile([stdio({ id: 's1', args: ['b.js'] })]) // changed args
    expect(c1.closed).toBe(true)        // old client closed
    expect(mgr.connectCount).toBe(2)    // reconnected
    expect(mgr.connectedIds()).toEqual(['s1'])
  })

  it('graceful-degrades: a failing server is skipped, others still connect', async () => {
    mgr.failIds.add('s1')
    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    expect(mgr.connectedIds()).toEqual(['s2'])
    expect(console.error).toHaveBeenCalled()
  })

  it('never throws when every server fails', async () => {
    mgr.failIds.add('s1')
    await expect(mgr.reconcile([stdio({ id: 's1' })])).resolves.toBeUndefined()
    expect(mgr.connectedIds()).toEqual([])
  })
})

describe('McpManager.tools', () => {
  it('namespaces each connected tool as mcp__<serverId>__<toolName>', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }], s2: [{ name: 'fetch' }] }
    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    const names = mgr.tools().map((t) => t.name).sort()
    expect(names).toEqual(['mcp__s1__search', 'mcp__s2__fetch'])
  })

  it('invoking a namespaced tool calls the right server with the un-namespaced name + args', async () => {
    mgr.toolsById = {
      s1: [{ name: 'add', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } }],
    }
    await mgr.reconcile([stdio({ id: 's1' })])
    const t = mgr.tools().find((x) => x.name === 'mcp__s1__add')!
    const out = String(await t.invoke({ a: 1, b: 2 }))
    const client = mgr.lastClients.get('s1')!
    expect(client.callArgs).toEqual([{ name: 'add', arguments: { a: 1, b: 2 } }])
    expect(out).toBe('ok') // FakeClient default content => "ok"
  })

  it('flattens multiple text content blocks', async () => {
    mgr.toolsById = { s1: [{ name: 'd' }] }
    await mgr.reconcile([stdio({ id: 's1' })])
    // swap the fake's call result to a multi-block payload
    const client = mgr.lastClients.get('s1')!
    ;(client as unknown as { callTool: (r: unknown) => Promise<unknown> }).callTool = async () => ({
      content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }],
    })
    const t = mgr.tools().find((x) => x.name === 'mcp__s1__d')!
    expect(String(await t.invoke({}))).toBe('line1\nline2')
  })

  it('surfaces an MCP isError result as an Error string', async () => {
    mgr.toolsById = { s1: [{ name: 'boom' }] }
    await mgr.reconcile([stdio({ id: 's1' })])
    const client = mgr.lastClients.get('s1')!
    ;(client as unknown as { callTool: (r: unknown) => Promise<unknown> }).callTool = async () => ({
      isError: true, content: [{ type: 'text', text: 'tool blew up' }],
    })
    const t = mgr.tools().find((x) => x.name === 'mcp__s1__boom')!
    expect(String(await t.invoke({}))).toMatch(/^Error: tool blew up/)
  })

  it('a callTool rejection is caught and returned as an Error string', async () => {
    mgr.toolsById = { s1: [{ name: 'flaky' }] }
    await mgr.reconcile([stdio({ id: 's1' })])
    const client = mgr.lastClients.get('s1')!
    ;(client as unknown as { callTool: (r: unknown) => Promise<unknown> }).callTool = async () => { throw new Error('network down') }
    const t = mgr.tools().find((x) => x.name === 'mcp__s1__flaky')!
    expect(String(await t.invoke({}))).toBe('Error: network down')
  })

  it('returns [] when nothing is connected', () => {
    expect(mgr.tools()).toEqual([])
  })
})
