import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chmodSync } from 'node:fs'
import type { GraphEmit } from '../graph.js'
import { AcpAgentProvider } from './acp-provider.js'
import { acpConnections } from './acp-connection.js'

const here = dirname(fileURLToPath(import.meta.url))
const AGENT = join(here, '__fixtures__', 'mock-acp-agent.mjs'); chmodSync(AGENT, 0o755)
afterEach(() => acpConnections.disposeAll())

function cap() {
  const out = { text: '', reasoning: '', tools: [] as string[][], toolEnds: [] as string[][] }
  const emit: GraphEmit = { token: (d) => { out.text += d }, reasoning: (d) => { out.reasoning += d },
    toolStarted: (n, id) => { out.tools.push([id, n]) }, toolFinished: (id, s) => { out.toolEnds.push([id, s]) }, usage: () => {}, planDelta: () => {}, compaction: () => {} }
  return { emit, out }
}
function cfg(extra: any = {}): any {
  return { id: 'mock', name: 'Mock', kind: 'acp', command: 'node', args: [AGENT], enabled: true, ...extra }
}

function withFs(p: AcpAgentProvider, mode: 'chat' | 'edit' | 'full' = 'edit'): AcpAgentProvider {
  p.setTurnFsContext({ cwd: process.cwd(), permissionMode: mode, readMaxBytes: 2_000_000 })
  return p
}

describe('AcpAgentProvider', () => {
  it('streams an answer through emit.token and resolves on end_turn', async () => {
    const p = withFs(new AcpAgentProvider(cfg(), process.cwd(), null))
    const a = cap()
    await p.runTurn('hi', a.emit, new AbortController().signal)
    expect(a.out.text).toContain('hello world')
    await p.dispose()
  })

  it('requires setTurnFsContext before runTurn', async () => {
    const p = new AcpAgentProvider(cfg(), process.cwd(), null)
    const a = cap()
    await expect(p.runTurn('hi', a.emit, new AbortController().signal))
      .rejects.toThrow(/setTurnFsContext required/)
    await p.dispose()
  })

  it('consumes turn FS context — second runTurn without re-set fails', async () => {
    const p = withFs(new AcpAgentProvider(cfg(), process.cwd(), null))
    const a = cap()
    await p.runTurn('first', a.emit, new AbortController().signal)
    // Context was consumed; must re-set before next turn
    const b = cap()
    await expect(p.runTurn('second', b.emit, new AbortController().signal))
      .rejects.toThrow(/setTurnFsContext required/)
    await p.dispose()
  })

  it('maps thought chunks to reasoning and tool calls to toolStarted/toolFinished', async () => {
    const p = withFs(new AcpAgentProvider(cfg(), process.cwd(), null))
    const a = cap()
    // drive the mock to emit a thought + a tool by spawning it with env via a dedicated agent cfg
    process.env.MOCK_ACP_THINK = '1'; process.env.MOCK_ACP_TOOL = '1'
    await p.runTurn('hi', a.emit, new AbortController().signal)
    delete process.env.MOCK_ACP_THINK; delete process.env.MOCK_ACP_TOOL
    expect(a.out.reasoning).toContain('thinking')
    expect(a.out.tools).toEqual([['t1', 'edit hello.txt']])
    expect(a.out.toolEnds).toEqual([['t1', 'finished']])
    await p.dispose()
  })

  it('cancel mid-stream rejects with AbortError even though the agent reports end_turn', async () => {
    const p = withFs(new AcpAgentProvider(cfg({ env: { MOCK_ACP_SLOW_MS: '200' } }), process.cwd(), null))
    const ac = new AbortController()
    const a = cap()
    const turn = p.runTurn('hi', a.emit, ac.signal)
    setTimeout(() => ac.abort(), 120) // abort after the first chunk
    await expect(turn).rejects.toThrowError(/abort/i)
    await p.dispose()
  })

  it('switches the live model via setConfigOption and the backend uses it', async () => {
    const p = withFs(new AcpAgentProvider(cfg(), process.cwd(), null))
    const a = cap()
    await p.runTurn('first', a.emit, new AbortController().signal) // answer(mock/base): ...
    // Multi-turn: after detachSink, openSessions still held and setConfigOption still works
    const conns = acpConnections.getConnections()
    expect(conns[0]?.sessionCount).toBe(1)
    await p.setConfigOption('model', 'mock/other')
    const b = cap()
    withFs(p)
    await p.runTurn('second', b.emit, new AbortController().signal)
    expect(b.out.text).toContain('mock/other')  // backend actually switched (mock echoes model)
    expect(conns[0]?.sessionCount).toBe(1) // still open across turns; no close mid-turn
    await p.dispose()
  })

  it('dispose awaits closeSession — openSessions cleared and closed session rejects prompt', async () => {
    const p = withFs(new AcpAgentProvider(cfg({
      id: 'mock-dispose-close',
      env: { MOCK_ACP_CLOSE_SLOW_MS: '60' },
    }), process.cwd(), null))
    const a = cap()
    await p.runTurn('hi', a.emit, new AbortController().signal)
    const sid = p.sessionId!
    expect(sid).toBeTruthy()
    const conn = acpConnections.getConnections()[0]!
    expect(conn.sessionCount).toBe(1)
    const t0 = Date.now()
    await p.dispose()
    expect(Date.now() - t0).toBeGreaterThanOrEqual(40)
    expect(conn.sessionCount).toBe(0)
    expect(p.sessionId).toBeNull()
    // Mock rejects prompt after session/close (SDK may wrap as Internal error)
    await expect(conn.prompt(sid, 'after-close')).rejects.toThrow()
  })

  it('maps ACP plan sessionUpdate to planUpdated', async () => {
    const p = withFs(new AcpAgentProvider(cfg({ env: { MOCK_ACP_PLAN: '1' } }), process.cwd(), null))
    const plans: any[] = []
    const emit: GraphEmit = {
      token: () => {},
      reasoning: () => {},
      toolStarted: () => {},
      toolFinished: () => {},
      usage: () => {},
      planDelta: () => {},
      planUpdated: (plan) => { plans.push(plan) },
      compaction: () => {},
    }
    await p.runTurn('hi', emit, new AbortController().signal)
    expect(plans).toEqual([[
      { content: 'step one', status: 'completed' },
      { content: 'step two', status: 'in_progress' },
    ]])
    await p.dispose()
  })

  it('recovers from a warm-child death — the next turn re-acquires a fresh child and succeeds (C1)', async () => {
    const p = withFs(new AcpAgentProvider(cfg(), process.cwd(), null))
    const a = cap()
    await p.runTurn('first', a.emit, new AbortController().signal)
    expect(a.out.text).toContain('hello world')
    // Simulate the warm child dying + the pool evicting it.
    acpConnections.disposeAll()
    await new Promise((r) => setTimeout(r, 200)) // let the child 'exit' fire → connection marked closed
    // The SAME provider must not be bricked: ensureSession re-acquires and reattaches/recreates.
    const b = cap()
    withFs(p)
    await p.runTurn('second', b.emit, new AbortController().signal)
    expect(b.out.text).toContain('hello world')
    await p.dispose()
  })
})
