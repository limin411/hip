import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { McpServerConfig } from '@hip/protocol'
import { McpManager, type ClientLike } from './manager.js'

const stdio = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 's1', name: 'S1', transport: 'stdio', command: 'node', args: ['a.js'], enabled: true, ...over,
})

class FlakyClient implements ClientLike {
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
  connectAttempts = 0
  failCounts = new Map<string, number>()
  toolsById: Record<string, Array<{ name: string; description?: string; inputSchema?: unknown }>> = {}

  protected async connect(server: McpServerConfig): Promise<ClientLike> {
    this.connectAttempts++
    const fails = this.failCounts.get(server.id) ?? 0
    if (fails > 0) {
      this.failCounts.set(server.id, fails - 1)
      throw new Error('connect boom #' + this.connectAttempts)
    }
    return new FlakyClient(this.toolsById[server.id] ?? [{ name: 'do_thing' }])
  }
}

let mgr: TestManager

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mgr = new TestManager()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('McpManager reconnect backoff', () => {
  it('schedules reconnect on connect failure', async () => {
    mgr.failCounts.set('s1', 999)
    mgr.toolsById = { s1: [{ name: 'search' }] }

    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.connectedIds()).toEqual([])
    expect(mgr.connectAttempts).toBe(1)
  })

  it('reconnects successfully after backoff retries', async () => {
    mgr.failCounts.set('s1', 2)
    mgr.toolsById = { s1: [{ name: 'search' }] }

    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.connectedIds()).toEqual([])
    expect(mgr.connectAttempts).toBe(1)

    await vi.advanceTimersByTimeAsync(500)
    expect(mgr.connectAttempts).toBe(2)
    expect(mgr.connectedIds()).toEqual([])

    await vi.advanceTimersByTimeAsync(1000)
    expect(mgr.connectAttempts).toBe(3)
    expect(mgr.connectedIds()).toEqual(['s1'])
  })

  it('exponential backoff doubles delay up to cap', async () => {
    mgr.failCounts.set('s1', 4)
    mgr.toolsById = { s1: [{ name: 'search' }] }

    await mgr.reconcile([stdio({ id: 's1' })])

    await vi.advanceTimersByTimeAsync(500)
    expect(mgr.connectAttempts).toBe(2)

    await vi.advanceTimersByTimeAsync(1000)
    expect(mgr.connectAttempts).toBe(3)

    await vi.advanceTimersByTimeAsync(2000)
    expect(mgr.connectAttempts).toBe(4)

    await vi.advanceTimersByTimeAsync(4000)
    expect(mgr.connectAttempts).toBe(5)
    expect(mgr.connectedIds()).toEqual(['s1'])
  })

  it('backoff delay resets to initial on successful connect', async () => {
    mgr.failCounts.set('s1', 2)
    mgr.toolsById = { s1: [{ name: 'search' }] }

    await mgr.reconcile([stdio({ id: 's1' })])
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mgr.connectedIds()).toEqual(['s1'])

    await mgr.reconcile([])
    expect(mgr.connectedIds()).toEqual([])

    const oldAttempts = mgr.connectAttempts
    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.connectedIds()).toEqual(['s1'])
    expect(mgr.connectAttempts).toBe(oldAttempts + 1)
  })

  it('cancels pending reconnect when server is removed from target', async () => {
    mgr.failCounts.set('s1', 999)

    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.connectedIds()).toEqual([])

    await mgr.reconcile([])

    const oldAttempts = mgr.connectAttempts
    await vi.advanceTimersByTimeAsync(50000)
    expect(mgr.connectAttempts).toBe(oldAttempts)
  })

  it('cancels pending reconnect when server config changes', async () => {
    mgr.failCounts.set('s1', 999)

    await mgr.reconcile([stdio({ id: 's1', args: ['a.js'] })])
    expect(mgr.connectedIds()).toEqual([])

    mgr.failCounts.set('s1', 0)
    await mgr.reconcile([stdio({ id: 's1', args: ['b.js'] })])
    expect(mgr.connectedIds()).toEqual(['s1'])

    const oldAttempts = mgr.connectAttempts
    await vi.advanceTimersByTimeAsync(50000)
    expect(mgr.connectAttempts).toBe(oldAttempts)
  })

  it('does not double-schedule reconnect when reconcile called while retry pending', async () => {
    mgr.failCounts.set('s1', 999)

    await mgr.reconcile([stdio({ id: 's1' })])
    const oldAttempts = mgr.connectAttempts

    await mgr.reconcile([stdio({ id: 's1' })])

    await vi.advanceTimersByTimeAsync(500)
    expect(mgr.connectAttempts).toBe(oldAttempts + 1)
  })
})
