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
  return { id: 'mock', name: 'Mock', kind: 'acp', command: 'node', args: [AGENT], enabled: true }
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

  it('synthesizes config options from models-only session/new (Grok-style)', async () => {
    const conn = await mgr.acquire({
      ...agentCfg(),
      id: 'mock-models',
      env: { MOCK_ACP_MODELS_ONLY: '1' },
    }, null)
    const { sessionId, configOptions } = await conn.newSessionWithOptions(process.cwd())
    expect(sessionId).toMatch(/^mock-sess-/)
    expect(configOptions.map((o: any) => o.id)).toEqual(['model', 'mode'])
    expect(configOptions.find((o: any) => o.id === 'model')!.currentValue).toBe('mock/base')
    expect(configOptions.find((o: any) => o.id === 'mode')!.options.map((x: any) => x.value)).toEqual(['high', 'low'])
  })

  it('falls back to session/set_model when set_config_option is missing (Grok-style)', async () => {
    const conn = await mgr.acquire({
      ...agentCfg(),
      id: 'mock-fallback',
      env: { MOCK_ACP_MODELS_ONLY: '1', MOCK_ACP_NO_SET_CONFIG: '1' },
    }, null)
    const { sessionId } = await conn.newSessionWithOptions(process.cwd())
    const res = await conn.setConfigOption(sessionId, 'model', 'mock/other')
    expect(res.configOptions?.find((o: any) => o.id === 'model')?.currentValue).toBe('mock/other')
    // Next prompt should echo the switched model via extMethod session/set_model
    let text = ''
    conn.registerSink(sessionId, {
      onUpdate: (u) => {
        if (u?.sessionUpdate === 'agent_message_chunk' && u.content?.text) text += u.content.text
      },
      onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    })
    await conn.prompt(sessionId, 'hi')
    expect(text).toContain('mock/other')
    conn.releaseSession(sessionId)
  })
})
