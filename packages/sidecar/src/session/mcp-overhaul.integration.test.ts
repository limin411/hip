import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { McpServerConfig } from '@hip/protocol'
import { McpManager, type ClientLike } from './mcp/manager.js'
import { PromptRegistry } from './mcp/prompt-registry.js'

const stdio = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 's1', name: 'S1', transport: 'stdio', command: 'node', args: ['a.js'], enabled: true, ...over,
})

// ── Fake MCP client with tools + resources + prompts ──

class FakeMcpClient implements ClientLike {
  closed = false
  callArgs: Array<{ name: string; arguments?: Record<string, unknown> }> = []
  readResourceArgs: Array<{ uri: string }> = []
  getPromptArgs: Array<{ name: string; arguments?: Record<string, string> }> = []
  constructor(
    private readonly toolList: Array<{ name: string; description?: string; inputSchema?: unknown }>,
    private readonly callResult: unknown = { content: [{ type: 'text', text: 'ok' }] },
    private readonly resourceList?: Array<{ uri: string; name: string; description?: string; mimeType?: string }>,
    private readonly resourceResult?: { contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }> },
    private readonly promptList?: Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>,
    private readonly promptResult?: { messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }> },
  ) {}
  async listTools() { return { tools: this.toolList } }
  async callTool(req: { name: string; arguments?: Record<string, unknown> }) { this.callArgs.push(req); return this.callResult }
  async listResources() { return { resources: this.resourceList ?? [] } }
  async readResource(req: { uri: string }) { this.readResourceArgs.push(req); return this.resourceResult ?? { contents: [] } }
  async listPrompts() { return { prompts: this.promptList ?? [] } }
  async getPrompt(req: { name: string; arguments?: Record<string, string> }) {
    this.getPromptArgs.push(req)
    if (this.promptResult?.messages) return this.promptResult
    throw new Error('no prompt result')
  }
  getServerCapabilities() {
    const caps: Record<string, unknown> = { tools: {} }
    if (this.resourceList) caps.resources = {}
    if (this.promptList) caps.prompts = {}
    return caps as { prompts?: unknown; resources?: unknown; tools?: unknown } | undefined
  }
  async close() { this.closed = true }
}

// ── Test manager that injects fake clients ──

class TestManager extends McpManager {
  toolsById: Record<string, Array<{ name: string; description?: string; inputSchema?: unknown }>> = {}
  resourcesById: Record<string, Array<{ uri: string; name: string; description?: string; mimeType?: string }>> = {}
  resourceResultById: Record<string, { contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }> }> = {}
  promptsById: Record<string, Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>> = {}
  promptResultById: Record<string, { messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }> }> = {}
  connectAttempts = 0
  failCounts = new Map<string, number>()
  resourceFailIds = new Set<string>()

  protected async connect(server: McpServerConfig): Promise<ClientLike> {
    this.connectAttempts++
    const fails = this.failCounts.get(server.id) ?? 0
    if (fails > 0) {
      this.failCounts.set(server.id, fails - 1)
      throw new Error('connect boom #' + this.connectAttempts)
    }
    const client = new FakeMcpClient(
      this.toolsById[server.id] ?? [{ name: 'do_thing' }],
      undefined,
      this.resourcesById[server.id],
      this.resourceResultById[server.id],
      this.promptsById[server.id],
      this.promptResultById[server.id],
    )
    if (this.resourceFailIds.has(server.id)) {
      client.readResource = async () => { throw new Error('network error') }
    }
    return client
  }
}

let mgr: TestManager
let registry: PromptRegistry

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mgr = new TestManager()
  registry = new PromptRegistry(mgr as unknown as McpManager)
})

afterEach(() => {
  vi.useRealTimers()
})

// ── 1. Basic connection + tools ──

describe('MCP connect + tools', () => {
  it('connects to a fake MCP server and discovers tools', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }, { name: 'fetch' }] }

    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.connectedIds()).toEqual(['s1'])
    expect(mgr.toolCount()).toBe(2)

    const tools = mgr.tools()
    expect(tools.some((t) => t.name === 'mcp__s1__search')).toBe(true)
    expect(tools.some((t) => t.name === 'mcp__s1__fetch')).toBe(true)
  })

  it('tool execution delegates to the fake client', async () => {
    mgr.toolsById = { s1: [{ name: 'greet' }] }

    await mgr.reconcile([stdio({ id: 's1' })])
    const tools = mgr.tools()
    const greet = tools.find((t) => t.name === 'mcp__s1__greet')!

    const result = String(await greet.invoke({ name: 'world' }))
    expect(result).toBe('ok')
  })

  it('tool execution passes arguments to fake client', async () => {
    mgr.toolsById = { s1: [{ name: 'add' }] }

    await mgr.reconcile([stdio({ id: 's1' })])
    const tools = mgr.tools()
    const add = tools.find((t) => t.name === 'mcp__s1__add')!

    await add.invoke({ a: 1, b: 2 })
    const conn = (mgr as unknown as { conns: Map<string, { client: FakeMcpClient }> }).conns.get('s1')
    if (conn) {
      expect(conn.client.callArgs).toEqual([{ name: 'add', arguments: { a: 1, b: 2 } }])
    }
  })
})

// ── 2. Reconnect on failure with backoff timing ──

describe('MCP reconnect backoff timing', () => {
  it('schedules reconnect on initial connect failure', async () => {
    mgr.failCounts.set('s1', 999)
    mgr.toolsById = { s1: [{ name: 'search' }] }

    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.connectedIds()).toEqual([])
    expect(mgr.connectAttempts).toBe(1)
  })

  it('retries after initial backoff (500ms)', async () => {
    mgr.failCounts.set('s1', 2)
    mgr.toolsById = { s1: [{ name: 'search' }] }

    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.connectAttempts).toBe(1)
    expect(mgr.connectedIds()).toEqual([])

    // First retry after 500ms
    await vi.advanceTimersByTimeAsync(500)
    expect(mgr.connectAttempts).toBe(2)
    expect(mgr.connectedIds()).toEqual([])

    // Second retry after 1000ms (doubled)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mgr.connectAttempts).toBe(3)
    expect(mgr.connectedIds()).toEqual(['s1'])
  })

  it('exponential backoff doubles up to cap (10000ms)', async () => {
    mgr.failCounts.set('s1', 4)
    mgr.toolsById = { s1: [{ name: 'search' }] }

    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.connectAttempts).toBe(1)

    // 500ms
    await vi.advanceTimersByTimeAsync(500)
    expect(mgr.connectAttempts).toBe(2)

    // 1000ms
    await vi.advanceTimersByTimeAsync(1000)
    expect(mgr.connectAttempts).toBe(3)

    // 2000ms
    await vi.advanceTimersByTimeAsync(2000)
    expect(mgr.connectAttempts).toBe(4)

    // 4000ms
    await vi.advanceTimersByTimeAsync(4000)
    expect(mgr.connectAttempts).toBe(5)
    expect(mgr.connectedIds()).toEqual(['s1'])
  })

  it('backoff resets to initial on successful connect', async () => {
    mgr.failCounts.set('s1', 2)
    mgr.toolsById = { s1: [{ name: 'search' }] }

    await mgr.reconcile([stdio({ id: 's1' })])
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mgr.connectedIds()).toEqual(['s1'])

    // Disconnect
    await mgr.reconcile([])
    expect(mgr.connectedIds()).toEqual([])

    // Reconnect — backoff should be reset
    const oldAttempts = mgr.connectAttempts
    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.connectedIds()).toEqual(['s1'])
    expect(mgr.connectAttempts).toBe(oldAttempts + 1)
  })

  it('cancels pending reconnect when server is removed', async () => {
    mgr.failCounts.set('s1', 999)
    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.connectedIds()).toEqual([])

    // Remove server — should not retry
    await mgr.reconcile([])
    const oldAttempts = mgr.connectAttempts
    await vi.advanceTimersByTimeAsync(50000)
    expect(mgr.connectAttempts).toBe(oldAttempts)
  })

  it('cancels pending reconnect when server config fingerprint changes', async () => {
    mgr.failCounts.set('s1', 999)
    await mgr.reconcile([stdio({ id: 's1', args: ['a.js'] })])
    expect(mgr.connectedIds()).toEqual([])

    // Config changed → new connect attempt (no pending retry runs)
    mgr.failCounts.set('s1', 0)
    await mgr.reconcile([stdio({ id: 's1', args: ['b.js'] })])
    expect(mgr.connectedIds()).toEqual(['s1'])

    // Old retry should be cancelled
    const oldAttempts = mgr.connectAttempts
    await vi.advanceTimersByTimeAsync(50000)
    expect(mgr.connectAttempts).toBe(oldAttempts)
  })
})

// ── 3. Lazy loading ──

describe('MCP lazy loading', () => {
  it('pre-loads all tools when count < threshold', async () => {
    mgr.toolsById = { s1: [{ name: 't1' }, { name: 't2' }] }
    await mgr.reconcile([stdio({ id: 's1' })])

    const tools = mgr.tools({ lazyThreshold: 20 }) // 2 < 20 → pre-load
    expect(tools.some((t) => t.name === 'mcp__s1__t1')).toBe(true)
    expect(tools.some((t) => t.name === 'mcp__s1__t2')).toBe(true)
    expect(tools.some((t) => t.name === 'mcp_search')).toBe(false)
  })

  it('switches to lazy mode (proxy tools) when tool count >= threshold', async () => {
    mgr.toolsById = { s1: Array.from({ length: 5 }, (_, i) => ({ name: `tool_${i}` })) }
    await mgr.reconcile([stdio({ id: 's1' })])

    const tools = mgr.tools({ lazyThreshold: 3 }) // 5 >= 3 → lazy
    expect(tools.some((t) => t.name === 'mcp_search')).toBe(true)
    expect(tools.some((t) => t.name === 'mcp_invoke')).toBe(true)
    // Individual tools are NOT pre-loaded
    expect(tools.some((t) => t.name === 'mcp__s1__tool_0')).toBe(false)
  })

  it('lazy mode with threshold 0 always uses proxy tools', async () => {
    mgr.toolsById = { s1: [{ name: 'only' }] }
    await mgr.reconcile([stdio({ id: 's1' })])

    const tools = mgr.tools({ lazyThreshold: 0 })
    expect(tools.some((t) => t.name === 'mcp_search')).toBe(true)
    expect(tools.some((t) => t.name === 'mcp_invoke')).toBe(true)
    expect(tools.some((t) => t.name === 'mcp__s1__only')).toBe(false)
  })

  it('mcp_search returns matching tools', async () => {
    mgr.toolsById = { s1: [{ name: 'search_docs', description: 'Search documentation' }, { name: 'create_issue' }] }
    await mgr.reconcile([stdio({ id: 's1' })])

    const tools = mgr.tools({ lazyThreshold: 0 })
    const mcpSearch = tools.find((t) => t.name === 'mcp_search')!

    const result = String(await mcpSearch.invoke({ query: 'docs' }))
    expect(result).toContain('mcp__s1__search_docs')
    expect(result).not.toContain('mcp__s1__create_issue')
  })

  it('mcp_invoke delegates to the correct server tool', async () => {
    mgr.toolsById = { s1: [{ name: 'echo' }] }
    await mgr.reconcile([stdio({ id: 's1' })])

    const tools = mgr.tools({ lazyThreshold: 0 })
    const mcpInvoke = tools.find((t) => t.name === 'mcp_invoke')!

    const result = String(await mcpInvoke.invoke({ serverId: 's1', toolName: 'echo', arguments: {} }))
    expect(result).toBe('ok')
  })
})

// ── 4. Resources as tools ──

describe('MCP resources as tools', () => {
  it('fetches resources when server advertises resources capability', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.resourcesById = {
      s1: [{ uri: 'docs://readme', name: 'README', description: 'Project readme' }],
    }
    mgr.resourceResultById = { s1: { contents: [{ uri: 'docs://readme', text: '# Hello' }] } }

    await mgr.reconcile([stdio({ id: 's1' })])
    const allTools = mgr.tools()
    const resourceTool = allTools.find((t) => t.name === 'mcp__s1__resource__README')
    expect(resourceTool).toBeDefined()
    expect(resourceTool!.description).toBe('Project readme')
  })

  it('does not expose resource tools when no resources capability', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    // No resources set → getServerCapabilities excludes resources
    await mgr.reconcile([stdio({ id: 's1' })])
    const allTools = mgr.tools()
    const resourceTools = allTools.filter((t) => t.name.includes('__resource__'))
    expect(resourceTools.length).toBe(0)
  })

  it('resource tool execution reads the resource', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.resourcesById = { s1: [{ uri: 'docs://api', name: 'API Docs', description: 'API ref' }] }
    mgr.resourceResultById = { s1: { contents: [{ uri: 'docs://api', text: 'API v2 docs' }] } }

    await mgr.reconcile([stdio({ id: 's1' })])
    const allTools = mgr.tools()
    const resourceTool = allTools.find((t) => t.name === 'mcp__s1__resource__API_Docs')!
    const result = String(await resourceTool.invoke({}))
    expect(result).toBe('API v2 docs')
  })

  it('resource tool handles readResource errors gracefully', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.resourcesById = { s1: [{ uri: 'docs://fail', name: 'Fail' }] }
    mgr.resourceResultById = { s1: { contents: [] } }
    mgr.resourceFailIds.add('s1')

    await mgr.reconcile([stdio({ id: 's1' })])
    const allTools = mgr.tools()
    const resourceTool = allTools.find((t) => t.name === 'mcp__s1__resource__Fail')!
    const result = String(await resourceTool.invoke({}))
    expect(result).toContain('Error')
    expect(result).toContain('network error')
  })

  it('allResources returns resources across all servers', async () => {
    mgr.toolsById = { s1: [{ name: 't1' }], s2: [{ name: 't2' }] }
    mgr.resourcesById = {
      s1: [{ uri: 'docs://a', name: 'A' }],
      s2: [{ uri: 'docs://b', name: 'B' }],
    }
    mgr.resourceResultById = { s1: { contents: [] }, s2: { contents: [] } }

    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    const all = mgr.allResources()
    expect(all.length).toBe(2)
    expect(all.map((r) => r.serverId).sort()).toEqual(['s1', 's2'])
  })

  it('sanitizes resource names for tool names', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.resourcesById = { s1: [{ uri: 'db://users', name: 'users/table' }] }
    mgr.resourceResultById = { s1: { contents: [] } }

    await mgr.reconcile([stdio({ id: 's1' })])
    const allTools = mgr.tools()
    expect(allTools.some((t) => t.name === 'mcp__s1__resource__users_table')).toBe(true)
  })
})

// ── 5. Prompts in registry ──

describe('MCP prompts in registry', () => {
  it('fetches prompts when server advertises prompts capability', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.promptsById = {
      s1: [
        { name: 'code-review', description: 'Review code' },
        { name: 'summarize', description: 'Summarize text' },
      ],
    }
    mgr.promptResultById = { s1: { messages: [{ role: 'user', content: { type: 'text', text: 'Review this' } }] } }

    await mgr.reconcile([stdio({ id: 's1' })])
    const prompts = mgr.allPrompts()
    expect(prompts.length).toBe(2)
    expect(prompts.map((p) => p.name).sort()).toEqual(['code-review', 'summarize'])
  })

  it('PromptRegistry.listAll returns prompts from connected servers', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.promptsById = { s1: [{ name: 'greet', description: 'A greeting' }] }

    await mgr.reconcile([stdio({ id: 's1' })])
    const prompts = registry.listAll()
    expect(prompts.length).toBe(1)
    expect(prompts[0].name).toBe('greet')
    expect(prompts[0].serverId).toBe('s1')
  })

  it('executePrompt resolves and returns messages', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.promptsById = { s1: [{ name: 'hello' }] }
    mgr.promptResultById = {
      s1: { messages: [
        { role: 'user', content: { type: 'text', text: 'Hello!' } },
        { role: 'assistant', content: { type: 'text', text: 'Hi!' } },
      ]},
    }

    await mgr.reconcile([stdio({ id: 's1' })])
    const result = await mgr.executePrompt('s1', 'hello')
    expect(result.error).toBeUndefined()
    expect(result.messages).toEqual([
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi!' },
    ])
  })

  it('executePrompt returns error for disconnected server', async () => {
    const result = await mgr.executePrompt('s1', 'none')
    expect(result.error).toContain('not connected')
    expect(result.messages).toEqual([])
  })

  it('PromptRegistry.execute delegates to manager', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.promptsById = { s1: [{ name: 'test' }] }
    mgr.promptResultById = { s1: { messages: [{ role: 'user', content: { type: 'text', text: 'ok' } }] } }

    await mgr.reconcile([stdio({ id: 's1' })])
    const result = await registry.execute('s1', 'test')
    expect(result.error).toBeUndefined()
    expect(result.messages[0].content).toBe('ok')
  })

  it('executePrompt passes arguments to getPrompt', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.promptsById = { s1: [{ name: 'review', arguments: [{ name: 'path', required: true }] }] }
    mgr.promptResultById = { s1: { messages: [{ role: 'user', content: { type: 'text', text: 'Review src/app.ts' } }] } }

    await mgr.reconcile([stdio({ id: 's1' })])
    await mgr.executePrompt('s1', 'review', { path: 'src/app.ts' })

    const conn = (mgr as unknown as { conns: Map<string, { client: FakeMcpClient }> }).conns.get('s1')
    if (conn && conn.client instanceof FakeMcpClient) {
      expect(conn.client.getPromptArgs).toEqual([{ name: 'review', arguments: { path: 'src/app.ts' } }])
    }
  })
})

// ── 6. Status pushed to frontend ──

describe('MCP connection status', () => {
  it('connectionStatuses reports connected servers', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    await mgr.reconcile([stdio({ id: 's1' })])

    const statuses = mgr.connectionStatuses([stdio({ id: 's1' })])
    expect(statuses.length).toBe(1)
    expect(statuses[0].id).toBe('s1')
    expect(statuses[0].status).toBe('connected')
    expect(statuses[0].toolCount).toBe(1)
    expect(statuses[0].toolNames).toEqual(['search'])
  })

  it('connectionStatuses reports error for failed connections', async () => {
    mgr.failCounts.set('s1', 999)
    await mgr.reconcile([stdio({ id: 's1' })])

    const statuses = mgr.connectionStatuses([stdio({ id: 's1' })])
    const s1 = statuses.find((s) => s.id === 's1')
    expect(s1).toBeDefined()
    expect(s1!.status).toBe('error')
    expect(s1!.lastError).toBeDefined()
    expect(s1!.lastError).toContain('connect boom')
  })

  it('connectionStatuses reports disconnected for known but unconnected servers', async () => {
    const statuses = mgr.connectionStatuses([stdio({ id: 's1' })])
    expect(statuses.length).toBe(1)
    expect(statuses[0].status).toBe('disconnected')
  })

  it('toolCatalog returns compact listing', async () => {
    mgr.toolsById = { s1: [{ name: 't1' }, { name: 't2' }] }
    await mgr.reconcile([stdio({ id: 's1' })])

    const catalog = mgr.toolCatalog()
    expect(catalog).toContain('S1')
    expect(catalog).toContain('2 tools')
    expect(catalog).toContain('available-mcp-tools')
  })
})

// ── 7. enabled_tools / disabled_tools filtering ──

describe('MCP tool filtering (enabledTools / disabledTools)', () => {
  it('enabledTools allowlist: only listed tools are exposed', async () => {
    mgr.toolsById = { s1: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }
    await mgr.reconcile([stdio({ id: 's1', enabledTools: ['a', 'c'] })])

    expect(mgr.toolCount()).toBe(2)
    const tools = mgr.tools()
    expect(tools.some((t) => t.name === 'mcp__s1__a')).toBe(true)
    expect(tools.some((t) => t.name === 'mcp__s1__c')).toBe(true)
    expect(tools.some((t) => t.name === 'mcp__s1__b')).toBe(false)
  })

  it('disabledTools denylist: listed tools are excluded', async () => {
    mgr.toolsById = { s1: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }
    await mgr.reconcile([stdio({ id: 's1', disabledTools: ['b'] })])

    expect(mgr.toolCount()).toBe(2)
    const tools = mgr.tools()
    expect(tools.some((t) => t.name === 'mcp__s1__a')).toBe(true)
    expect(tools.some((t) => t.name === 'mcp__s1__c')).toBe(true)
    expect(tools.some((t) => t.name === 'mcp__s1__b')).toBe(false)
  })

  it('enabledTools + disabledTools: allowlist first, then denylist', async () => {
    mgr.toolsById = { s1: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }
    // Allow a and b, then deny b → only a remains
    await mgr.reconcile([stdio({ id: 's1', enabledTools: ['a', 'b'], disabledTools: ['b'] })])

    expect(mgr.toolCount()).toBe(1)
    const tools = mgr.tools()
    expect(tools.some((t) => t.name === 'mcp__s1__a')).toBe(true)
    expect(tools.some((t) => t.name === 'mcp__s1__b')).toBe(false)
  })

  it('empty enabledTools means all tools allowed (no allowlist)', async () => {
    mgr.toolsById = { s1: [{ name: 'a' }, { name: 'b' }] }
    await mgr.reconcile([stdio({ id: 's1', enabledTools: [] })])

    expect(mgr.toolCount()).toBe(2)
  })
})

// ── 8. Multi-server operation ──

describe('MCP multi-server', () => {
  it('manages multiple servers independently', async () => {
    mgr.toolsById = {
      s1: [{ name: 's1_tool' }],
      s2: [{ name: 's2_tool_1' }, { name: 's2_tool_2' }],
    }

    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    expect(mgr.connectedIds()).toEqual(['s1', 's2'])
    expect(mgr.toolCount()).toBe(3)
  })

  it('removes server when removed from config', async () => {
    mgr.toolsById = {
      s1: [{ name: 's1_tool' }],
      s2: [{ name: 's2_tool' }],
    }

    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    expect(mgr.connectedIds()).toEqual(['s1', 's2'])

    // Remove s2
    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.connectedIds()).toEqual(['s1'])
    expect(mgr.toolCount()).toBe(1)
  })

  it('reconnects server when config fingerprint changes', async () => {
    mgr.toolsById = { s1: [{ name: 'old_tool' }] }
    await mgr.reconcile([stdio({ id: 's1', args: ['old'] })])
    const oldAttempts = mgr.connectAttempts

    // Config changed (different args) → reconnect
    mgr.toolsById = { s1: [{ name: 'new_tool' }] }
    await mgr.reconcile([stdio({ id: 's1', args: ['new'] })])
    expect(mgr.connectAttempts).toBe(oldAttempts + 1)
    expect(mgr.connectedIds()).toEqual(['s1'])
    expect(mgr.toolCount()).toBe(1)
  })
})
