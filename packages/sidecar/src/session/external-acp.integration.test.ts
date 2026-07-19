import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chmodSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { ServerMessage, AgentConfig } from '@hip/protocol'
import { SessionManager } from './session-manager.js'
import { writeHipToml } from './__testutils__/config-helpers.js'
import { acpConnections } from './agents/acp-connection.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const here = dirname(fileURLToPath(import.meta.url))
const AGENT = join(here, 'agents', '__fixtures__', 'mock-acp-agent.mjs'); chmodSync(AGENT, 0o755)

function registerMockAgent(dir: string, env?: Record<string, string>): void {
  const agent: AgentConfig = {
    id: 'mock', name: 'Mock', kind: 'acp', command: 'node', args: [AGENT],
    enabled: true, env,
  }
  process.env.HIP_CONFIG_PATH = writeHipToml(dir, { agents: [agent] })
}

async function waitForTerminal(out: ServerMessage[], predicate: (m: ServerMessage) => boolean, timeoutMs = 10000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (out.some(predicate)) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`Timeout waiting for terminal message`)
}

async function resetMockAgent(): Promise<void> {
  // The mock agent reads stdin; sending {"reset":true} clears its module state.
  for (const conn of acpConnections.getConnections()) {
    try {
      ;(conn as any).child?.stdin?.write('{"reset":true}\n')
    } catch {
      // ignore if already closed
    }
  }
}

describe('external ACP agent through SessionManager', () => {
  afterEach(async () => {
    // Close any open ACP connection.
    acpConnections.disposeAll()
    // Reset mutable mock-agent state so the next test starts clean.
    await resetMockAgent()
  })

  it('routes a turn to the acp agent and streams reasoning + text + tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-acp-'))
    registerMockAgent(dir, { MOCK_ACP_THINK: '1', MOCK_ACP_TOOL: '1' })

    const mgr = new SessionManager(undefined, () => undefined, dir)
    const out: ServerMessage[] = []
    mgr.handle({ type: 'session:create', id: 's1', config: { agentId: 'mock', cwd: dir } as any }, (m) => out.push(m))
    await mgr.handle({ type: 'message:send', sessionId: 's1', id: 'm1', content: 'hi', role: 'user' } as any, (m) => out.push(m))
    await waitForTerminal(out, (m) => m.type === 'message:complete')

    expect(out.some((m) => m.type === 'reasoning:delta')).toBe(true)
    expect(out.some((m) => m.type === 'token:stream' && m.delta.includes('hello'))).toBe(true)
    expect(out.some((m) => m.type === 'tool:started')).toBe(true)
    expect(out.some((m) => m.type === 'message:complete')).toBe(true)
  }, 20000)

  it('emits permission:request and proceeds when the client responds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-acp-'))
    registerMockAgent(dir, { MOCK_ACP_PERMISSION: '1', MOCK_ACP_TOOL: '1' })
    const mgr = new SessionManager(undefined, () => undefined, dir)
    const out: ServerMessage[] = []
    const send = (m: ServerMessage) => {
      out.push(m)
      if (m.type === 'permission:request') mgr.handle({ type: 'permission:respond', sessionId: m.sessionId, requestId: m.requestId, optionId: 'once' } as any, send)
    }
    mgr.handle({ type: 'session:create', id: 's1', config: { agentId: 'mock', cwd: dir } as any }, send)
    await mgr.handle({ type: 'message:send', sessionId: 's1', id: 'm1', content: 'edit', role: 'user' } as any, send)
    await waitForTerminal(out, (m) => m.type === 'message:complete')

    expect(out.some((m) => m.type === 'permission:request')).toBe(true)
    // I3: the modal payload must carry the tool's diff so the user sees what they're approving.
    const perm = out.find((m) => m.type === 'permission:request') as Extract<ServerMessage, { type: 'permission:request' }> | undefined
    expect(perm?.tool.diff?.path).toBe('hello.txt')
    expect(perm?.tool.diff?.newText).toBe('hi')
    expect(out.some((m) => m.type === 'tool:finished' && m.status === 'finished')).toBe(true)
    expect(out.some((m) => m.type === 'message:complete')).toBe(true)
  }, 20000)

  it('rejecting a permission stops the tool and still completes the turn cleanly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-acp-'))
    registerMockAgent(dir, { MOCK_ACP_PERMISSION: '1', MOCK_ACP_TOOL: '1' })
    const mgr = new SessionManager(undefined, () => undefined, dir)
    const out: ServerMessage[] = []
    const send = (m: ServerMessage) => {
      out.push(m)
      if (m.type === 'permission:request') mgr.handle({ type: 'permission:respond', sessionId: m.sessionId, requestId: m.requestId, cancelled: true } as any, send)
    }
    mgr.handle({ type: 'session:create', id: 's1', config: { agentId: 'mock', cwd: dir } as any }, send)
    await mgr.handle({ type: 'message:send', sessionId: 's1', id: 'm1', content: 'edit', role: 'user' } as any, send)
    await waitForTerminal(out, (m) => m.type === 'message:complete')

    expect(out.some((m) => m.type === 'permission:request')).toBe(true)
    // Rejected → the gated tool must NOT report a successful finish, and the turn still completes.
    expect(out.some((m) => m.type === 'tool:finished' && m.status === 'finished')).toBe(false)
    expect(out.some((m) => m.type === 'message:complete')).toBe(true)
    expect(out.some((m) => m.type === 'error' && m.code === 'AGENT_ERROR')).toBe(false)
  }, 20000)

  it('cancelling mid-stream stops the turn without an AGENT_ERROR (cancel-via-own-flag)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-acp-'))
    registerMockAgent(dir, { MOCK_ACP_SLOW_MS: '200' })
    const mgr = new SessionManager(undefined, () => undefined, dir)
    const out: ServerMessage[] = []
    const send = (m: ServerMessage) => out.push(m)
    mgr.handle({ type: 'session:create', id: 's1', config: { agentId: 'mock', cwd: dir } as any }, send)
    const turn = mgr.handle({ type: 'message:send', sessionId: 's1', id: 'm1', content: 'hi', role: 'user' } as any, send)
    await waitForTerminal(out, (m) => m.type === 'token:stream')
    mgr.handle({ type: 'message:cancel', sessionId: 's1' } as any, send)
    await turn
    await waitForTerminal(out, (m) => m.type === 'message:complete' || (m.type === 'error' && m.code === 'CANCELLED'))

    // Cancel must NOT surface as AGENT_ERROR (OpenCode returns end_turn on cancel — we rely on our own
    // abort flag). The turn ends as a stopped completion or an explicit CANCELLED.
    expect(out.some((m) => m.type === 'error' && m.code === 'AGENT_ERROR')).toBe(false)
    expect(out.some((m) => m.type === 'message:complete' || (m.type === 'error' && m.code === 'CANCELLED'))).toBe(true)
  }, 20000)

  it('reopens a prior ACP session via loadSession and replays history', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-acp-'))
    // seed the store with a session that already has an acp_session_id
    const { db } = openDatabase(':memory:'); const store = new SessionStore(db, false)
    const now = Date.now()
    store.insertSession({ id: 's1', title: 't', config: JSON.stringify({ agentId: 'mock', cwd: dir }), createdAt: now, updatedAt: now })
    store.setAcpSessionId('s1', 'mock-sess-1')
    registerMockAgent(dir)
    const mgr = new SessionManager(store, () => undefined, dir)
    const out: ServerMessage[] = []
    await mgr.handle({ type: 'message:send', sessionId: 's1', id: 'm1', content: 'continue', role: 'user' } as any, (m) => out.push(m))
    await waitForTerminal(out, (m) => m.type === 'message:complete')

    // The mock prefixes its answer 'resumed(...)' ONLY when loadSession ran — proving the reopen
    // branch was taken (a fresh newSession would prefix 'answer(...)'; see the negative control below).
    const text = out.filter((m) => m.type === 'token:stream').map((m) => (m as Extract<ServerMessage, { type: 'token:stream' }>).delta).join('')
    expect(text).toContain('resumed(')
    expect(text).not.toContain('answer(')
  }, 20000)

  it('negative control: a session with NO acp_session_id starts fresh (newSession, not loadSession)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-acp-'))
    const { db } = openDatabase(':memory:'); const store = new SessionStore(db, false)
    const now = Date.now()
    store.insertSession({ id: 's1', title: 't', config: JSON.stringify({ agentId: 'mock', cwd: dir }), createdAt: now, updatedAt: now })
    // NOTE: no setAcpSessionId — this is a brand-new conversation.
    registerMockAgent(dir)
    const mgr = new SessionManager(store, () => undefined, dir)
    const out: ServerMessage[] = []
    await mgr.handle({ type: 'message:send', sessionId: 's1', id: 'm1', content: 'hi', role: 'user' } as any, (m) => out.push(m))
    await waitForTerminal(out, (m) => m.type === 'message:complete')

    const text = out.filter((m) => m.type === 'token:stream').map((m) => (m as Extract<ServerMessage, { type: 'token:stream' }>).delta).join('')
    expect(text).toContain('answer(')
    expect(text).not.toContain('resumed(')
  }, 20000)

  it('session:delete disposes the live Session so ACP closeSession runs (openSessions cleared)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-acp-'))
    registerMockAgent(dir)
    const mgr = new SessionManager(undefined, () => undefined, dir)
    const out: ServerMessage[] = []
    const send = (m: ServerMessage) => out.push(m)
    mgr.handle({ type: 'session:create', id: 's1', config: { agentId: 'mock', cwd: dir } as any }, send)
    await mgr.handle({ type: 'message:send', sessionId: 's1', id: 'm1', content: 'hi', role: 'user' } as any, send)
    await waitForTerminal(out, (m) => m.type === 'message:complete')

    const conn = acpConnections.getConnections()[0]
    expect(conn).toBeDefined()
    expect(conn!.sessionCount).toBe(1)

    const before = out.length
    mgr.handle({ type: 'session:delete', sessionId: 's1' }, send)
    // session:deleted stays synchronous for clients
    expect(out.slice(before).some((m) => m.type === 'session:deleted')).toBe(true)

    // destroy is fire-and-forget after delete — wait for closeSession to settle
    const start = Date.now()
    while (conn!.sessionCount !== 0 && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 30))
    }
    expect(conn!.sessionCount).toBe(0)
  }, 20000)
})
