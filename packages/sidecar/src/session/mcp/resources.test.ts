import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpServerConfig } from '@hip/protocol'
import { McpManager, type ClientLike } from './manager.js'

const stdio = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 's1', name: 'S1', transport: 'stdio', command: 'node', args: ['a.js'], enabled: true, ...over,
})

class FakeClient implements ClientLike {
  closed = false
  callArgs: Array<{ name: string; arguments?: Record<string, unknown> }> = []
  readResourceArgs: Array<{ uri: string }> = []
  constructor(
    private readonly toolList: Array<{ name: string; description?: string; inputSchema?: unknown }>,
    private readonly callResult: unknown = { content: [{ type: 'text', text: 'ok' }] },
    private readonly resourceList?: Array<{ uri: string; name: string; description?: string; mimeType?: string }>,
    private readonly resourceResult?: { contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }> },
  ) {}
  async listTools() { return { tools: this.toolList } }
  async callTool(req: { name: string; arguments?: Record<string, unknown> }) { this.callArgs.push(req); return this.callResult }
  async listResources() { return { resources: this.resourceList ?? [] } }
  async readResource(req: { uri: string }) { this.readResourceArgs.push(req); return this.resourceResult ?? { contents: [] } }
  getServerCapabilities() { return this.resourceList ? { resources: {} } : undefined }
  async close() { this.closed = true }
}

class TestManager extends McpManager {
  toolsById: Record<string, Array<{ name: string; description?: string; inputSchema?: unknown }>> = {}
  resourcesById: Record<string, Array<{ uri: string; name: string; description?: string; mimeType?: string }>> = {}
  resourceResultById: Record<string, { contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }> }> = {}
  /** Server ids whose readResource should throw an error. */
  resourceFailIds = new Set<string>()

  protected async connect(server: McpServerConfig): Promise<ClientLike> {
    const client = new FakeClient(
      this.toolsById[server.id] ?? [{ name: 'do_thing' }],
      undefined,
      this.resourcesById[server.id],
      this.resourceResultById[server.id],
    )
    if (this.resourceFailIds.has(server.id)) {
      client.readResource = async () => { throw new Error('network error') }
    }
    return client
  }
}

let mgr: TestManager

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mgr = new TestManager()
})

describe('McpManager resources as tools', () => {
  it('fetches resources when server advertises resources capability', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.resourcesById = { s1: [{ uri: 'docs://readme', name: 'README', description: 'Project readme' }] }
    mgr.resourceResultById = { s1: { contents: [{ uri: 'docs://readme', text: '# Hello' }] } }

    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.connectedIds()).toEqual(['s1'])

    // Resource should be exposed as a tool
    const allTools = mgr.tools()
    const resourceTool = allTools.find((t) => t.name === 'mcp__s1__resource__README')
    expect(resourceTool).toBeDefined()
    expect(resourceTool!.description).toBe('Project readme')
  })

  it('does not fetch resources when server has no resources capability', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    // No resources set on FakeClient → getServerCapabilities returns undefined → resources skipped

    await mgr.reconcile([stdio({ id: 's1' })])
    const allTools = mgr.tools()
    const resourceTools = allTools.filter((t) => t.name.includes('__resource__'))
    expect(resourceTools.length).toBe(0)
  })

  it('resource tool execution calls readResource with the resource uri', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.resourcesById = { s1: [{ uri: 'docs://api', name: 'API Docs', description: 'API reference' }] }
    mgr.resourceResultById = { s1: { contents: [{ uri: 'docs://api', text: 'API v2 documentation' }] } }

    await mgr.reconcile([stdio({ id: 's1' })])
    const allTools = mgr.tools()
    const resourceTool = allTools.find((t) => t.name === 'mcp__s1__resource__API_Docs')!

    const result = String(await resourceTool.invoke({}))
    expect(result).toBe('API v2 documentation')
  })

  it('resource tool handles readResource failure gracefully', async () => {
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

  it('resource tool handles multi-content resource results', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.resourcesById = { s1: [{ uri: 'docs://multi', name: 'Multi' }] }
    mgr.resourceResultById = {
      s1: {
        contents: [
          { uri: 'docs://multi', text: 'Part 1' },
          { uri: 'docs://multi', text: 'Part 2' },
        ],
      },
    }

    await mgr.reconcile([stdio({ id: 's1' })])
    const allTools = mgr.tools()
    const resourceTool = allTools.find((t) => t.name === 'mcp__s1__resource__Multi')!

    const result = String(await resourceTool.invoke({}))
    expect(result).toContain('Part 1')
    expect(result).toContain('Part 2')
  })

  it('sanitizes resource names with special characters for tool names', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.resourcesById = {
      s1: [
        { uri: 'db://users', name: 'users/table', description: 'Users table' },
        { uri: 'db://posts', name: 'my.data.v1', description: 'Posts' },
      ],
    }
    mgr.resourceResultById = { s1: { contents: [] } }

    await mgr.reconcile([stdio({ id: 's1' })])
    const allTools = mgr.tools()
    const names = allTools.filter((t) => t.name.includes('__resource__')).map((t) => t.name).sort()
    expect(names).toContain('mcp__s1__resource__users_table')
    expect(names).toContain('mcp__s1__resource__my_data_v1')
  })

  it('allResources returns resources across all servers', async () => {
    mgr.toolsById = {
      s1: [{ name: 's1_tool' }],
      s2: [{ name: 's2_tool' }],
    }
    mgr.resourcesById = {
      s1: [{ uri: 'docs://a', name: 'A' }],
      s2: [{ uri: 'docs://b', name: 'B' }],
    }
    mgr.resourceResultById = {
      s1: { contents: [] },
      s2: { contents: [] },
    }

    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    const all = mgr.allResources()
    expect(all.length).toBe(2)
    expect(all.map((r) => r.serverId).sort()).toEqual(['s1', 's2'])
    expect(all.map((r) => r.name).sort()).toEqual(['A', 'B'])
  })
})
