import { describe, it, expect } from 'vitest'
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

describe('external ACP agent through SessionManager', () => {
  it('routes a turn to the acp agent and streams reasoning + text + tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-acp-'))
    registerMockAgent(dir, { MOCK_ACP_THINK: '1', MOCK_ACP_TOOL: '1' })

    const mgr = new SessionManager(undefined, () => undefined, dir)
    const out: ServerMessage[] = []
    mgr.handle({ type: 'session:create', id: 's1', config: { agentId: 'mock', cwd: dir } as any }, (m) => out.push(m))
    await mgr.handle({ type: 'message:send', sessionId: 's1', id: 'm1', content: 'hi', role: 'user' } as any, (m) => out.push(m))
    // settle
    await new Promise((r) => setTimeout(r, 500))
    acpConnections.disposeAll()

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
    await new Promise((r) => setTimeout(r, 800))
    acpConnections.disposeAll()
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
    await new Promise((r) => setTimeout(r, 800))
    acpConnections.disposeAll()
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
    await new Promise((r) => setTimeout(r, 150)) // after the first chunk, before the stream finishes
    mgr.handle({ type: 'message:cancel', sessionId: 's1' } as any, send)
    await turn
    await new Promise((r) => setTimeout(r, 200))
    acpConnections.disposeAll()
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
    await new Promise((r) => setTimeout(r, 800))
    acpConnections.disposeAll()
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
    await new Promise((r) => setTimeout(r, 800))
    acpConnections.disposeAll()
    const text = out.filter((m) => m.type === 'token:stream').map((m) => (m as Extract<ServerMessage, { type: 'token:stream' }>).delta).join('')
    expect(text).toContain('answer(')
    expect(text).not.toContain('resumed(')
  }, 20000)
})
