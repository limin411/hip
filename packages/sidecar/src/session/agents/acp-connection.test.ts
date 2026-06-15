import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chmodSync } from 'node:fs'
import { AcpConnectionManager } from './acp-connection.js'

const here = dirname(fileURLToPath(import.meta.url))
const AGENT = join(here, '__fixtures__', 'mock-acp-agent.mjs')
chmodSync(AGENT, 0o755)

const mgr = new AcpConnectionManager()
afterEach(() => mgr.disposeAll())

function agentCfg(): any {
  return { id: 'mock', name: 'Mock', kind: 'acp', command: 'node', args: [AGENT], transport: 'rich', acceptsModelConfig: false, enabled: true }
}

describe('AcpConnectionManager', () => {
  it('multiplexes two sessions over ONE child process', async () => {
    const conn = await mgr.acquire(agentCfg(), null)
    const a = await conn.newSession(process.cwd())
    const b = await conn.newSession(process.cwd())
    expect(conn.childPid).toBeGreaterThan(0)
    expect(a).not.toBe(b)
    expect(conn.sessionCount).toBe(2)
    conn.releaseSession(a)
    expect(conn.sessionCount).toBe(1)
  })

  it('evicts a dead connection so the next acquire spawns a fresh child', async () => {
    const conn = await mgr.acquire(agentCfg(), null)
    const pid1 = conn.childPid
    conn.dispose()                       // simulate death
    await new Promise((r) => setTimeout(r, 100))
    const conn2 = await mgr.acquire(agentCfg(), null)
    expect(conn2.childPid).not.toBe(pid1) // fresh child, not the dead one
  })
})
