import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chmodSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { AcpConnectionManager } from './acp-connection.js'

const here = dirname(fileURLToPath(import.meta.url))
const AGENT = join(here, '__fixtures__', 'mock-acp-agent.mjs')
chmodSync(AGENT, 0o755)

const mgr = new AcpConnectionManager()
const tmpDirs: string[] = []
afterEach(() => {
  mgr.disposeAll()
  delete process.env.HIP_CONFIG_PATH
  for (const d of tmpDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ok */ }
  }
})

function agentCfg(extra: any = {}): any {
  return { id: 'mock', name: 'Mock', kind: 'acp', command: 'node', args: [AGENT], enabled: true, ...extra }
}

describe('AcpConnectionManager', () => {
  it('multiplexes two sessions over ONE child process', async () => {
    const conn = await mgr.acquire(agentCfg(), null)
    const a = await conn.newSession(process.cwd())
    const b = await conn.newSession(process.cwd())
    expect(conn.childPid).toBeGreaterThan(0)
    expect(a).not.toBe(b)
    expect(conn.sessionCount).toBe(2)
    await conn.closeSession(a)
    expect(conn.sessionCount).toBe(1)
  })

  it('detachSink keeps openSessions; closeSession drops them and rejects further prompt', async () => {
    const conn = await mgr.acquire(agentCfg({ id: 'mock-detach' }), null)
    const { sessionId } = await conn.newSessionWithOptions(process.cwd())
    expect(conn.sessionCount).toBe(1)
    conn.registerSink(sessionId, {
      onUpdate: () => {},
      onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    })
    conn.detachSink(sessionId)
    // openSessions + configOptions preserved across turn boundary
    expect(conn.sessionCount).toBe(1)
    const res = await conn.setConfigOption(sessionId, 'model', 'mock/other')
    expect(res.configOptions?.find((o: any) => o.id === 'model')?.currentValue).toBe('mock/other')
    await conn.closeSession(sessionId)
    expect(conn.sessionCount).toBe(0)
    // Mock rejects prompt after session/close (SDK may wrap as Internal error)
    await expect(conn.prompt(sessionId, 'hi')).rejects.toThrow()
  })

  it('closeSession settles only after agent close RPC when advertised', async () => {
    const conn = await mgr.acquire({
      ...agentCfg(),
      id: 'mock-close-slow',
      env: { MOCK_ACP_CLOSE_SLOW_MS: '80' },
    }, null)
    const sid = await conn.newSession(process.cwd())
    const t0 = Date.now()
    await conn.closeSession(sid)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(60)
    expect(conn.sessionCount).toBe(0)
  })

  it('closeSession is re-entrant: second call is no-op; concurrent closes coalesce', async () => {
    const conn = await mgr.acquire({
      ...agentCfg(),
      id: 'mock-close-reentry',
      env: { MOCK_ACP_CLOSE_SLOW_MS: '80' },
    }, null)
    const sid = await conn.newSession(process.cwd())
    const t0 = Date.now()
    await Promise.all([conn.closeSession(sid), conn.closeSession(sid)])
    // One RPC only — not 2× slow close
    expect(Date.now() - t0).toBeLessThan(160)
    expect(conn.sessionCount).toBe(0)
    // Already closed — still settles without throwing
    await conn.closeSession(sid)
    expect(conn.sessionCount).toBe(0)
  })

  it('closeSession clears local maps without SDK RPC when close capability omitted (MOCK_ACP_NO_CLOSE)', async () => {
    const conn = await mgr.acquire({
      ...agentCfg(),
      id: 'mock-no-close',
      // CLOSE_SLOW would delay if RPC ran; with NO_CLOSE host must not call it.
      env: { MOCK_ACP_NO_CLOSE: '1', MOCK_ACP_CLOSE_SLOW_MS: '200' },
    }, null)
    const sid = await conn.newSession(process.cwd())
    expect(conn.sessionCount).toBe(1)
    const t0 = Date.now()
    await conn.closeSession(sid)
    expect(Date.now() - t0).toBeLessThan(100)
    expect(conn.sessionCount).toBe(0)
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
    conn.detachSink(sessionId)
  })

  it('advertises fs capabilities by default', async () => {
    const conn = await mgr.acquire(agentCfg({ id: 'mock-fs-on' }), null)
    await conn.newSession(process.cwd())
    expect(conn.advertisedFs).toBe(true)
  })

  it('does not advertise fs when [acp] fs_bridge = false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-cfg-'))
    tmpDirs.push(dir)
    const cfgPath = join(dir, 'hip.toml')
    writeFileSync(cfgPath, `version = 1\n\n[acp]\nfs_bridge = false\n`)
    process.env.HIP_CONFIG_PATH = cfgPath
    const conn = await mgr.acquire(agentCfg({ id: 'mock-fs-off' }), null)
    await conn.newSession(process.cwd())
    expect(conn.advertisedFs).toBe(false)
  })

  it('denies FS read/write when no setFsContext (no cross-session leak)', async () => {
    const conn = await mgr.acquire(agentCfg({ id: 'mock-no-ctx' }), null)
    const sid = await conn.newSession(process.cwd())
    // Intentionally do NOT call setFsContext
    await expect(conn.handleFsRead({ sessionId: sid, path: 'any.txt' })).rejects.toMatchObject({
      message: expect.stringContaining('ACP fs: permission denied'),
      data: { code: 'permission_denied' },
    })
    await expect(
      conn.handleFsWrite({ sessionId: sid, path: 'any.txt', content: 'x' }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('ACP fs: permission denied'),
      data: { code: 'permission_denied' },
    })
  })

  it('hard-denies FS when fs_bridge=false even if context is set (kill-switch)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-cfg-'))
    tmpDirs.push(dir)
    const cfgPath = join(dir, 'hip.toml')
    writeFileSync(cfgPath, `version = 1\n\n[acp]\nfs_bridge = false\n`)
    process.env.HIP_CONFIG_PATH = cfgPath
    const conn = await mgr.acquire(agentCfg({ id: 'mock-fs-kill' }), null)
    const sid = await conn.newSession(process.cwd())
    conn.setFsContext(sid, {
      cwd: process.cwd(),
      permissionMode: 'edit',
      readMaxBytes: 2_000_000,
    })
    await expect(conn.handleFsRead({ sessionId: sid, path: 'package.json' })).rejects.toMatchObject({
      message: expect.stringContaining('ACP fs: permission denied'),
      data: { code: 'permission_denied' },
    })
    await expect(
      conn.handleFsWrite({ sessionId: sid, path: 'x.txt', content: 'nope' }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('ACP fs: permission denied'),
      data: { code: 'permission_denied' },
    })
  })
})
