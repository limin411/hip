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
    toolStarted: (n, id) => { out.tools.push([id, n]) }, toolFinished: (id, s) => { out.toolEnds.push([id, s]) }, usage: () => {} }
  return { emit, out }
}
function cfg(extra: any = {}): any {
  return { id: 'mock', name: 'Mock', kind: 'acp', command: 'node', args: [AGENT], enabled: true, ...extra }
}

describe('AcpAgentProvider', () => {
  it('streams an answer through emit.token and resolves on end_turn', async () => {
    const p = new AcpAgentProvider(cfg(), process.cwd(), null)
    const a = cap()
    await p.runTurn('hi', a.emit, new AbortController().signal)
    expect(a.out.text).toContain('hello world')
    p.dispose()
  })

  it('maps thought chunks to reasoning and tool calls to toolStarted/toolFinished', async () => {
    const p = new AcpAgentProvider(cfg(), process.cwd(), null)
    const a = cap()
    // drive the mock to emit a thought + a tool by spawning it with env via a dedicated agent cfg
    process.env.MOCK_ACP_THINK = '1'; process.env.MOCK_ACP_TOOL = '1'
    await p.runTurn('hi', a.emit, new AbortController().signal)
    delete process.env.MOCK_ACP_THINK; delete process.env.MOCK_ACP_TOOL
    expect(a.out.reasoning).toContain('thinking')
    expect(a.out.tools).toEqual([['t1', 'edit hello.txt']])
    expect(a.out.toolEnds).toEqual([['t1', 'finished']])
    p.dispose()
  })

  it('cancel mid-stream rejects with AbortError even though the agent reports end_turn', async () => {
    const p = new AcpAgentProvider(cfg({ env: { MOCK_ACP_SLOW_MS: '200' } }), process.cwd(), null)
    const ac = new AbortController()
    const a = cap()
    const turn = p.runTurn('hi', a.emit, ac.signal)
    setTimeout(() => ac.abort(), 120) // abort after the first chunk
    await expect(turn).rejects.toThrowError(/abort/i)
    p.dispose()
  })

  it('switches the live model via setConfigOption and the backend uses it', async () => {
    const p = new AcpAgentProvider(cfg(), process.cwd(), null)
    const a = cap()
    await p.runTurn('first', a.emit, new AbortController().signal) // answer(mock/base): ...
    await p.setConfigOption('model', 'mock/other')
    const b = cap()
    await p.runTurn('second', b.emit, new AbortController().signal)
    expect(b.out.text).toContain('mock/other')  // backend actually switched (mock echoes model)
    p.dispose()
  })

  it('recovers from a warm-child death — the next turn re-acquires a fresh child and succeeds (C1)', async () => {
    const p = new AcpAgentProvider(cfg(), process.cwd(), null)
    const a = cap()
    await p.runTurn('first', a.emit, new AbortController().signal)
    expect(a.out.text).toContain('hello world')
    // Simulate the warm child dying + the pool evicting it.
    acpConnections.disposeAll()
    await new Promise((r) => setTimeout(r, 200)) // let the child 'exit' fire → connection marked closed
    // The SAME provider must not be bricked: ensureSession re-acquires and reattaches/recreates.
    const b = cap()
    await p.runTurn('second', b.emit, new AbortController().signal)
    expect(b.out.text).toContain('hello world')
    p.dispose()
  })
})
