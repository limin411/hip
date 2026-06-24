import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerMessage, McpServerConfig } from '@hip/protocol'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import { ConfigManager } from './config-manager.js'
import { mcpManager } from './mcp/manager.js'
import { SessionManager } from './session-manager.js'

// ── Shared fixture data ──

const FAKE_MCP_CONFIGS: McpServerConfig[] = [
  { id: 'mcp1', name: 'Test MCP', transport: 'stdio', command: 'echo', enabled: true },
]

const FAKE_STATUSES = [
  { id: 'mcp1', name: 'Test MCP', status: 'connected' as const, toolCount: 3, toolNames: ['a', 'b', 'c'] },
]

const SESSION_ID = 'test-mcp-status'

// ── Tests ──

describe('ensureSession MCP status', () => {
  let scratchRoot: string
  let store: SessionStore
  let mgr: SessionManager
  let sent: ServerMessage[]
  const send = (m: ServerMessage) => { sent.push(m) }

  beforeEach(() => {
    scratchRoot = mkdtempSync(path.join(os.tmpdir(), 'hip-mcp-status-'))

    // In-memory SQLite store with a persisted session row
    const { db, ftsEnabled } = openDatabase(':memory:')
    store = new SessionStore(db, ftsEnabled)
    const config = JSON.stringify({ llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd: scratchRoot })
    store.insertSession({ id: SESSION_ID, title: '新对话', config, createdAt: Date.now(), updatedAt: Date.now() })

    // Mock ConfigManager.mcpConfigs so ensureSession sees non-empty MCP configs
    vi.spyOn(ConfigManager.prototype, 'mcpConfigs', 'get').mockReturnValue(FAKE_MCP_CONFIGS)

    // Mock mcpManager.connectionStatuses to return a known status array
    vi.spyOn(mcpManager, 'connectionStatuses').mockReturnValue(FAKE_STATUSES)

    mgr = new SessionManager(store, undefined, scratchRoot)
    sent = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(scratchRoot, { recursive: true, force: true })
  })

  it('sends mcp:status when creating a new session with MCP config', async () => {
    await mgr.handleAsync(
      { type: 'session:setThinking', sessionId: SESSION_ID, thinking: true },
      send,
    )

    const mcpStatus = sent.find((m): m is Extract<ServerMessage, { type: 'mcp:status' }> => m.type === 'mcp:status')
    expect(mcpStatus).toBeDefined()
    expect(mcpStatus!.servers).toEqual(FAKE_STATUSES)
  })

  it('does NOT send mcp:status when session is already cached', async () => {
    // First call — ensureSession creates + caches the session, sends mcp:status
    await mgr.handleAsync(
      { type: 'session:setThinking', sessionId: SESSION_ID, thinking: true },
      send,
    )

    // Verify mcp:status was sent on the first call
    const firstMcpStatuses = sent.filter((m) => m.type === 'mcp:status')
    expect(firstMcpStatuses.length).toBe(1)

    // Reset captured messages for the second call
    sent = []

    // Second call — session is already cached, should NOT send another mcp:status
    await mgr.handleAsync(
      { type: 'session:setThinking', sessionId: SESSION_ID, thinking: true },
      send,
    )

    const secondMcpStatuses = sent.filter((m) => m.type === 'mcp:status')
    expect(secondMcpStatuses.length).toBe(0)
  })
})
