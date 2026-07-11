import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { McpServerConfig } from '@hip/protocol'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { SessionApprovalCache } from './tool-runner/approval-cache.js'
import { HookRegistry } from './hooks/registry.js'
import { buildSessionTooling } from './session-tooling.js'
import { NetworkPolicy } from './network-policy.js'
import { openDatabase } from '../persistence/open.js'
import { MemoryStore } from '../memory/store.js'
import { MemoryService } from '../memory/service.js'
import { buildTools } from './tools.js'

const reconciledConfigs: McpServerConfig[] = []
const deregisteredScopes: unknown[] = []
const fakeMcpTools: Array<{ name: string; description: string }> = [
  { name: 'mcp__fs__read_file', description: 'read' },
  { name: 'mcp__fs__write_file', description: 'write' },
]

vi.mock('./mcp/manager.js', () => ({
  mcpManager: {
    async reconcile(servers: McpServerConfig[]) {
      reconciledConfigs.length = 0
      reconciledConfigs.push(...servers)
    },
    tools() {
      return fakeMcpTools as any
    },
    connectionStatuses() {
      return []
    },
    toolCatalog() {
      return ''
    },
    registerWithRegistry(registry: any, scope: any) {
      for (const t of fakeMcpTools) {
        registry.register(t, scope)
      }
    },
    deregisterScope(scope: any) {
      deregisteredScopes.push(scope)
    },
  },
}))

function fakeRunner(): ModelRunner {
  return {
    async run(_messages: BaseMessage[], _opts: ModelRunOptions): Promise<AIMessage> {
      return new AIMessage('ok')
    },
  }
}

function baseInput() {
  return {
    cwd: '/tmp/project',
    sessionId: 's-tooling',
    mode: 'edit' as const,
    skills: [],
    mcpConfigs: [{ id: 'fs', name: 'Filesystem', transport: 'stdio' as const, command: '/usr/bin/fake', enabled: true }],
    enabledAgents: [],
    spawnSubagent: vi.fn(async (_description: string) => 'done'),
    hooks: new HookRegistry(),
    approvalCache: new SessionApprovalCache(),
    usesEnvModel: false,
    runner: fakeRunner(),
    networkPolicy: new NetworkPolicy(),
    onToolStarted: vi.fn(),
    onToolFinished: vi.fn(),
    emitRisk: vi.fn(),
  }
}

describe('buildSessionTooling', () => {
  beforeEach(() => {
    reconciledConfigs.length = 0
    deregisteredScopes.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('reconciles the provided MCP server configs', async () => {
    await buildSessionTooling(baseInput())

    expect(reconciledConfigs).toHaveLength(1)
    expect(reconciledConfigs[0]?.id).toBe('fs')
  })

  it('returns built-in tools plus MCP tools', async () => {
    const tooling = await buildSessionTooling(baseInput())

    const names = tooling.tools.map((t) => t.name)
    expect(names).toContain('read_file')
    expect(names).toContain('write_file')
    expect(names).toContain('mcp__fs__read_file')
    expect(names).toContain('mcp__fs__write_file')
  })

  it('filters out blocked tools', async () => {
    const tooling = await buildSessionTooling({
      ...baseInput(),
      blockedTools: ['write_file'],
    })

    const names = tooling.tools.map((t) => t.name)
    expect(names).toContain('read_file')
    expect(names).not.toContain('write_file')
  })

  it('keeps only allowed tools (while still allowing MCP tools)', async () => {
    const tooling = await buildSessionTooling({
      ...baseInput(),
      allowedTools: ['read_file'],
    })

    const names = tooling.tools.map((t) => t.name)
    expect(names).toContain('read_file')
    expect(names).not.toContain('write_file')
    expect(names).toContain('mcp__fs__read_file')
  })

  it('deregisters the MCP scope on cleanup', async () => {
    const tooling = await buildSessionTooling(baseInput())

    expect(deregisteredScopes).toHaveLength(0)
    tooling.cleanup()
    expect(deregisteredScopes).toHaveLength(1)
  })

  it('omits memory_* tools when useMemories is false', async () => {
    const { db, memoriesFtsEnabled } = openDatabase(':memory:')
    const memoryService = new MemoryService(new MemoryStore(db, memoriesFtsEnabled))
    const tooling = await buildSessionTooling({
      ...baseInput(),
      memoryService,
      useMemories: false,
    })
    const names = tooling.tools.map((t) => t.name)
    expect(names.filter((n) => n.startsWith('memory_'))).toEqual([])
  })

  it('registers memory_* tools when useMemories and memoryService are set', async () => {
    const { db, memoriesFtsEnabled } = openDatabase(':memory:')
    const memoryService = new MemoryService(new MemoryStore(db, memoriesFtsEnabled))
    const tooling = await buildSessionTooling({
      ...baseInput(),
      memoryService,
      useMemories: true,
    })
    const names = tooling.tools.map((t) => t.name)
    expect(names).toContain('memory_search')
    expect(names).toContain('memory_add')
    expect(names).toContain('memory_replace')
    expect(names).toContain('memory_remove')
  })

  it('subagent buildTools path does not include memory_* tools', () => {
    // Subagents call buildTools(...) and never go through buildSessionTooling.
    const names = buildTools('/tmp/project').map((t) => t.name)
    expect(names.filter((n) => n.startsWith('memory_'))).toEqual([])
  })
})
