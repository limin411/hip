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
  return { id: 'mock', name: 'Mock', kind: 'acp', command: 'node', args: [AGENT], transport: 'rich', acceptsModelConfig: false, enabled: true, ...extra }
}

describe('AcpAgentProvider', () => {
  it('streams an answer through emit.token and resolves on end_turn', async () => {
    const p = new AcpAgentProvider(cfg(), process.cwd(), null)
    const a = cap()
    await p.runTurn('hi', a.emit, new AbortController().signal)
    expect(a.out.text).toContain('hello world')
    p.dispose()
  })
})
