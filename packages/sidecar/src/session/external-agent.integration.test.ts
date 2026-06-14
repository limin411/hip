import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { nanoid } from 'nanoid'
import type { ServerMessage, SessionConfig, AgentsConfig } from '@hip/protocol'
import { SessionManager } from './session-manager.js'

const here = dirname(fileURLToPath(import.meta.url))
const THIN = join(here, 'agents', '__fixtures__', 'echo-thin-agent.mjs')
const RICH = join(here, 'agents', '__fixtures__', 'rich-variant-agent.mjs')
const BRIDGE = resolve(process.cwd(), 'scripts/opencode-bridge.mjs')
const MOCK_SERVER = join(here, 'agents', '__fixtures__', 'mock-opencode-server.mjs')

const tmps: string[] = []
afterEach(() => { for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true }); delete process.env.HIP_AGENTS_PATH })

function writeAgents(cfg: AgentsConfig): string {
  const dir = mkdtempSync(join(tmpdir(), 'hip-agents-')); tmps.push(dir)
  const p = join(dir, 'hip-agents.json'); writeFileSync(p, JSON.stringify(cfg)); return p
}
function tmpCwd(): string { const d = mkdtempSync(join(tmpdir(), 'hip-cwd-')); tmps.push(d); return d }

describe('external agent end-to-end through SessionManager', () => {
  it('routes a turn to the custom agent and streams its echo into a completed message', async () => {
    const agentId = 'agent-' + nanoid()
    process.env.HIP_AGENTS_PATH = writeAgents({ agents: [
      { id: agentId, name: 'Echo', kind: 'custom', command: 'node', args: [THIN], transport: 'thin', acceptsModelConfig: false, enabled: true },
    ] })

    const mgr = new SessionManager()
    const out: ServerMessage[] = []
    const sessionId = 's-' + nanoid()
    const config: SessionConfig = { llmProvider: 'deepseek', model: 'm', tools: [], cwd: tmpCwd(), agentId }

    const created = new Promise<void>((res) => {
      mgr.handle({ type: 'session:create', id: sessionId, config }, (m) => { out.push(m); if (m.type === 'session:created') res() })
    })
    await created

    const completed = new Promise<ServerMessage>((res) => {
      mgr.handle({ type: 'message:send', sessionId, id: nanoid(), content: 'ping', role: 'user' }, (m) => { out.push(m); if (m.type === 'message:complete') res(m) })
    })
    const done = await completed

    const streamed = out.filter((m) => m.type === 'token:stream').map((m) => (m as Extract<ServerMessage, { type: 'token:stream' }>).delta).join('')
    expect(streamed).toContain('echo: ping')
    expect(done.type).toBe('message:complete')
    if (done.type === 'message:complete') expect(done.message.content).toContain('echo: ping')
  })

  // Regression guard for the "Rich protocol shows no thinking" report: prove the
  // sidecar forwards a RICH external agent's reasoning all the way out as the same
  // `reasoning:delta` events the UI renders for the built-in agent. (The OpenCode
  // bridge's job is to PRODUCE those reasoning events; this proves hip relays them.)
  it('relays a rich external agent\'s reasoning out as reasoning:delta (the thinking the UI renders)', async () => {
    const agentId = 'agent-' + nanoid()
    process.env.HIP_AGENTS_PATH = writeAgents({ agents: [
      { id: agentId, name: 'RichEcho', kind: 'custom', command: 'node', args: [RICH], transport: 'rich', acceptsModelConfig: false, enabled: true },
    ] })

    const mgr = new SessionManager()
    const out: ServerMessage[] = []
    const sessionId = 's-' + nanoid()
    const config: SessionConfig = { llmProvider: 'deepseek', model: 'm', tools: [], cwd: tmpCwd(), agentId }

    await new Promise<void>((res) => {
      mgr.handle({ type: 'session:create', id: sessionId, config }, (m) => { out.push(m); if (m.type === 'session:created') res() })
    })
    await new Promise<ServerMessage>((res) => {
      mgr.handle({ type: 'message:send', sessionId, id: nanoid(), content: 'ping', role: 'user' }, (m) => { out.push(m); if (m.type === 'message:complete') res(m) })
    })

    const reasoning = out
      .filter((m) => m.type === 'reasoning:delta')
      .map((m) => (m as Extract<ServerMessage, { type: 'reasoning:delta' }>).delta)
      .join('')
    expect(reasoning).toContain('thinking…') // the rich agent's reasoning reached the UI channel
    // and tool events from the same rich turn are relayed too
    expect(out.some((m) => m.type === 'tool:started')).toBe(true)
  })

  // The full real path, paid-free: SessionManager → Session → LoopAgentProvider(rich)
  // → the REAL scripts/opencode-bridge.mjs → a mock `opencode serve` emitting OpenCode's
  // real SSE shape → reasoning/tool/text → reasoning:delta + token:stream out. This is the
  // exact wiring a user gets with the OpenCode-Rich agent, minus the paid LLM.
  it('end-to-end: SessionManager → opencode-bridge --rich → mock serve → reasoning:delta', async () => {
    chmodSync(MOCK_SERVER, 0o755)
    const agentId = 'agent-' + nanoid()
    process.env.HIP_AGENTS_PATH = writeAgents({ agents: [
      { id: agentId, name: 'OpenCode-Rich', kind: 'custom', command: 'node', args: [BRIDGE, '--rich'], transport: 'rich', acceptsModelConfig: false, enabled: true, env: { OPENCODE_BIN: MOCK_SERVER } },
    ] })

    const mgr = new SessionManager()
    const out: ServerMessage[] = []
    const sessionId = 's-' + nanoid()
    const config: SessionConfig = { llmProvider: 'deepseek', model: 'm', tools: [], cwd: tmpCwd(), agentId }

    await new Promise<void>((res) => {
      mgr.handle({ type: 'session:create', id: sessionId, config }, (m) => { out.push(m); if (m.type === 'session:created') res() })
    })
    await new Promise<ServerMessage>((res) => {
      mgr.handle({ type: 'message:send', sessionId, id: nanoid(), content: 'ping', role: 'user' }, (m) => { out.push(m); if (m.type === 'message:complete') res(m) })
    })

    const reasoning = out.filter((m) => m.type === 'reasoning:delta').map((m) => (m as Extract<ServerMessage, { type: 'reasoning:delta' }>).delta).join('')
    const text = out.filter((m) => m.type === 'token:stream').map((m) => (m as Extract<ServerMessage, { type: 'token:stream' }>).delta).join('')
    expect(reasoning).toContain('thinking about ping') // thinking streamed all the way through the real bridge
    expect(text).toContain('reply to: ping')           // and the answer
    expect(text).not.toContain('please')               // user prompt not echoed (role-gated in the bridge)
    expect(out.some((m) => m.type === 'tool:started')).toBe(true) // the `task` sub-agent tool
  }, 20000)
})
