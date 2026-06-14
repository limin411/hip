import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { nanoid } from 'nanoid'
import type { ServerMessage, SessionConfig, AgentsConfig } from '@hip/protocol'
import { SessionManager } from './session-manager.js'

const here = dirname(fileURLToPath(import.meta.url))
const THIN = join(here, 'agents', '__fixtures__', 'echo-thin-agent.mjs')

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
})
