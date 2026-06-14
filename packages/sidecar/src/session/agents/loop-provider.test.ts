import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { AgentConfig } from '@hip/protocol'
import { LoopAgentProvider } from './loop-provider.js'
import type { GraphEmit } from '../graph.js'

const here = dirname(fileURLToPath(import.meta.url))
const THIN = join(here, '__fixtures__', 'echo-thin-agent.mjs')
const RICH = join(here, '__fixtures__', 'echo-rich-agent.mjs')

interface Captured { text: string; reasoning: string; tools: Array<[string, string]>; toolEnds: Array<[string, string]> }
function captureEmit(): { emit: GraphEmit; cap: Captured } {
  const cap: Captured = { text: '', reasoning: '', tools: [], toolEnds: [] }
  const emit: GraphEmit = {
    token: (d) => { cap.text += d },
    reasoning: (d) => { cap.reasoning += d },
    toolStarted: (name, callId) => { cap.tools.push([callId, name]) },
    toolFinished: (callId, status) => { cap.toolEnds.push([callId, status]) },
    usage: () => {},
  }
  return { emit, cap }
}

const thinAgent: AgentConfig = { id: 'thin', name: 'Thin', kind: 'custom', command: 'node', args: [THIN], transport: 'thin', acceptsModelConfig: false, enabled: true }
const richAgent: AgentConfig = { id: 'rich', name: 'Rich', kind: 'custom', command: 'node', args: [RICH], transport: 'rich', acceptsModelConfig: false, enabled: true }

const providers: LoopAgentProvider[] = []
afterEach(() => { for (const p of providers.splice(0)) p.dispose() })

describe('LoopAgentProvider — thin', () => {
  it('streams the echoed text and reuses one process across turns', async () => {
    const p = new LoopAgentProvider(thinAgent, process.cwd(), null); providers.push(p)
    const a = captureEmit(); await p.runTurn('hello', a.emit, new AbortController().signal)
    expect(a.cap.text).toBe('echo: hello')
    const b = captureEmit(); await p.runTurn('again', b.emit, new AbortController().signal)
    expect(b.cap.text).toBe('echo: again')
  })

  it('injects the HIP_* model env when acceptsModelConfig', async () => {
    const p = new LoopAgentProvider({ ...thinAgent, acceptsModelConfig: true }, process.cwd(), { providerID: 'acme', modelID: 'acme-large', baseURL: 'u', apiKey: 'sk' })
    providers.push(p)
    const a = captureEmit(); await p.runTurn('hi', a.emit, new AbortController().signal)
    expect(a.cap.text).toBe('echo: hi [model=acme-large]')
  })
})

describe('LoopAgentProvider — rich', () => {
  it('maps rich events to emit calls', async () => {
    const p = new LoopAgentProvider(richAgent, process.cwd(), null); providers.push(p)
    const a = captureEmit(); await p.runTurn('hey', a.emit, new AbortController().signal)
    expect(a.cap.text).toBe('echo: hey')
    expect(a.cap.tools).toEqual([['t1', 'noop']])
    expect(a.cap.toolEnds).toEqual([['t1', 'finished']])
  })
})

describe('LoopAgentProvider — cancellation', () => {
  it('rejects with an AbortError when the signal aborts', async () => {
    const hang: AgentConfig = { ...thinAgent, command: 'cat', args: [] }
    const p = new LoopAgentProvider(hang, process.cwd(), null); providers.push(p)
    const ac = new AbortController()
    const a = captureEmit()
    const turn = p.runTurn('hello', a.emit, ac.signal)
    ac.abort()
    await expect(turn).rejects.toMatchObject({ name: 'AbortError' })
  })
})
