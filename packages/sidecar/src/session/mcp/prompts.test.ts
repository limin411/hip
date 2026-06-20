import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpServerConfig } from '@hip/protocol'
import { McpManager, type ClientLike } from './manager.js'
import { PromptRegistry } from './prompt-registry.js'

const stdio = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 's1', name: 'S1', transport: 'stdio', command: 'node', args: ['a.js'], enabled: true, ...over,
})

class FakeClient implements ClientLike {
  closed = false
  callArgs: Array<{ name: string; arguments?: Record<string, unknown> }> = []
  getPromptArgs: Array<{ name: string; arguments?: Record<string, string> }> = []
  constructor(
    private readonly toolList: Array<{ name: string; description?: string; inputSchema?: unknown }>,
    private readonly promptList?: Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>,
    private readonly promptResult?: { messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }> },
  ) {}
  async listTools() { return { tools: this.toolList } }
  async callTool(_req: { name: string; arguments?: Record<string, unknown> }) { return { content: [{ type: 'text', text: 'ok' }] } }
  async listPrompts() { return { prompts: this.promptList ?? [] } }
  async getPrompt(req: { name: string; arguments?: Record<string, string> }) {
    this.getPromptArgs.push(req)
    if (this.promptResult?.messages) return this.promptResult
    throw new Error('no prompt result configured')
  }
  getServerCapabilities() { return this.promptList ? { prompts: {} } : undefined }
  async close() { this.closed = true }
}

class TestManager extends McpManager {
  toolsById: Record<string, Array<{ name: string; description?: string; inputSchema?: unknown }>> = {}
  promptsById: Record<string, Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>> = {}
  promptResultById: Record<string, { messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }> }> = {}

  protected async connect(server: McpServerConfig): Promise<ClientLike> {
    return new FakeClient(
      this.toolsById[server.id] ?? [{ name: 'do_thing' }],
      this.promptsById[server.id],
      this.promptResultById[server.id],
    )
  }
}

let mgr: TestManager
let registry: PromptRegistry

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mgr = new TestManager()
  registry = new PromptRegistry(mgr as unknown as McpManager)
})

describe('McpManager prompts', () => {
  it('fetches prompts when server advertises prompts capability', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.promptsById = {
      s1: [
        { name: 'code-review', description: 'Review code for issues' },
        { name: 'summarize', description: 'Summarize text' },
      ],
    }
    mgr.promptResultById = { s1: { messages: [{ role: 'user', content: { type: 'text', text: 'Review this' } }] } }

    await mgr.reconcile([stdio({ id: 's1' })])

    const prompts = mgr.allPrompts()
    expect(prompts.length).toBe(2)
    expect(prompts.map((p) => p.name).sort()).toEqual(['code-review', 'summarize'])
  })

  it('allPrompts returns empty when no servers have prompts', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.allPrompts()).toEqual([])
  })

  it('executePrompt calls getPrompt and returns messages', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.promptsById = { s1: [{ name: 'greet', description: 'Greeting prompt' }] }
    mgr.promptResultById = {
      s1: {
        messages: [
          { role: 'user', content: { type: 'text', text: 'Hello!' } },
          { role: 'assistant', content: { type: 'text', text: 'Hi there!' } },
        ],
      },
    }

    await mgr.reconcile([stdio({ id: 's1' })])

    const result = await mgr.executePrompt('s1', 'greet')
    expect(result.error).toBeUndefined()
    expect(result.messages).toEqual([
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there!' },
    ])
  })

  it('executePrompt returns error when server not connected', async () => {
    const result = await mgr.executePrompt('s1', 'nonexistent')
    expect(result.error).toContain('not connected')
    expect(result.messages).toEqual([])
  })

  it('executePrompt returns error when getPrompt throws', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.promptsById = { s1: [{ name: 'broken' }] }

    await mgr.reconcile([stdio({ id: 's1' })])

    const result = await mgr.executePrompt('s1', 'broken')
    expect(result.error).toBeDefined()
    expect(result.messages).toEqual([])
  })

  it('executePrompt passes arguments to getPrompt', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.promptsById = { s1: [{ name: 'review', arguments: [{ name: 'path', required: true }] }] }
    mgr.promptResultById = {
      s1: { messages: [{ role: 'user', content: { type: 'text', text: 'Review src/app.ts' } }] },
    }

    await mgr.reconcile([stdio({ id: 's1' })])
    await mgr.executePrompt('s1', 'review', { path: 'src/app.ts' })

    const conn = (mgr as unknown as { conns: Map<string, { client: FakeClient }> }).conns.get('s1')
    if (conn && conn.client instanceof FakeClient) {
      expect(conn.client.getPromptArgs).toEqual([{ name: 'review', arguments: { path: 'src/app.ts' } }])
    }
  })
})

describe('PromptRegistry', () => {
  it('listAll returns prompts from connected servers', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.promptsById = { s1: [{ name: 'hello', description: 'A greeting' }] }

    await mgr.reconcile([stdio({ id: 's1' })])

    const prompts = registry.listAll()
    expect(prompts.length).toBe(1)
    expect(prompts[0].name).toBe('hello')
    expect(prompts[0].serverId).toBe('s1')
  })

  it('execute delegates to McpManager', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }] }
    mgr.promptsById = { s1: [{ name: 'test' }] }
    mgr.promptResultById = { s1: { messages: [{ role: 'user', content: { type: 'text', text: 'ok' } }] } }

    await mgr.reconcile([stdio({ id: 's1' })])

    const result = await registry.execute('s1', 'test')
    expect(result.error).toBeUndefined()
    expect(result.messages[0].content).toBe('ok')
  })
})
