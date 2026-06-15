import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chmodSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'
import { acpConnections } from './agents/acp-connection.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const here = dirname(fileURLToPath(import.meta.url))
const AGENT = join(here, 'agents', '__fixtures__', 'mock-acp-agent.mjs'); chmodSync(AGENT, 0o755)

describe('external ACP agent through SessionManager', () => {
  it('routes a turn to the acp agent and streams reasoning + text + tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-acp-'))
    const agentsPath = join(dir, 'hip-agents.json')
    writeFileSync(agentsPath, JSON.stringify({ agents: [{
      id: 'mock', name: 'Mock', kind: 'acp', command: 'node', args: [AGENT],
      transport: 'rich', acceptsModelConfig: false, enabled: true, env: { MOCK_ACP_THINK: '1', MOCK_ACP_TOOL: '1' },
    }] }))
    process.env.HIP_AGENTS_PATH = agentsPath

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
    const agentsPath = join(dir, 'hip-agents.json')
    writeFileSync(agentsPath, JSON.stringify({ agents: [{
      id: 'mock', name: 'Mock', kind: 'acp', command: 'node', args: [AGENT],
      transport: 'rich', acceptsModelConfig: false, enabled: true, env: { MOCK_ACP_PERMISSION: '1', MOCK_ACP_TOOL: '1' },
    }] }))
    process.env.HIP_AGENTS_PATH = agentsPath
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
    expect(out.some((m) => m.type === 'tool:finished' && m.status === 'finished')).toBe(true)
    expect(out.some((m) => m.type === 'message:complete')).toBe(true)
  }, 20000)

  it('reopens a prior ACP session via loadSession and replays history', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-acp-'))
    // seed the store with a session that already has an acp_session_id
    const { db } = openDatabase(':memory:'); const store = new SessionStore(db, false)
    const now = Date.now()
    store.insertSession({ id: 's1', title: 't', config: JSON.stringify({ agentId: 'mock', cwd: dir }), createdAt: now, updatedAt: now })
    store.setAcpSessionId('s1', 'mock-sess-1')
    writeFileSync(join(dir, 'hip-agents.json'), JSON.stringify({ agents: [{ id: 'mock', name: 'Mock', kind: 'acp', command: 'node', args: [AGENT], transport: 'rich', acceptsModelConfig: false, enabled: true }] }))
    process.env.HIP_AGENTS_PATH = join(dir, 'hip-agents.json')
    const mgr = new SessionManager(store, () => undefined, dir)
    const out: ServerMessage[] = []
    await mgr.handle({ type: 'message:send', sessionId: 's1', id: 'm1', content: 'continue', role: 'user' } as any, (m) => out.push(m))
    await new Promise((r) => setTimeout(r, 800))
    acpConnections.disposeAll()
    // the mock's loadSession replays 'prior answer'; then the new turn answers
    expect(out.some((m) => m.type === 'token:stream' && m.delta.includes('hello'))).toBe(true)
  }, 20000)
})
