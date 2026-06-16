import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { AgentConfig } from '@hip/protocol'
import { LoopAgentProvider } from './loop-provider.js'
import type { GraphEmit } from '../graph.js'

const here = dirname(fileURLToPath(import.meta.url))
const THIN = join(here, '__fixtures__', 'echo-thin-agent.mjs')
const RICH = join(here, '__fixtures__', 'echo-rich-agent.mjs')
const RICH_VARIANT = join(here, '__fixtures__', 'rich-variant-agent.mjs')

type ToolEnd = [callId: string, status: string, output?: string, error?: string]
interface Captured { text: string; reasoning: string; tools: Array<[string, string]>; toolEnds: ToolEnd[] }
function captureEmit(): { emit: GraphEmit; cap: Captured } {
  const cap: Captured = { text: '', reasoning: '', tools: [], toolEnds: [] }
  const emit: GraphEmit = {
    token: (d) => { cap.text += d },
    reasoning: (d) => { cap.reasoning += d },
    toolStarted: (name, callId) => { cap.tools.push([callId, name]) },
    toolFinished: (callId, status, output, error) => { cap.toolEnds.push([callId, status, output, error]) },
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
})

describe('LoopAgentProvider — rich', () => {
  it('maps rich events to emit calls', async () => {
    const p = new LoopAgentProvider(richAgent, process.cwd(), null); providers.push(p)
    const a = captureEmit(); await p.runTurn('hey', a.emit, new AbortController().signal)
    expect(a.cap.text).toBe('echo: hey')
    expect(a.cap.tools).toEqual([['t1', 'noop']])
    expect(a.cap.toolEnds.map((e) => [e[0], e[1]])).toEqual([['t1', 'finished']])
    expect(a.cap.toolEnds[0]).toEqual(['t1', 'finished', 'fine', undefined])
  })

  it('maps reasoning and a failed tool_end to the error branch', async () => {
    const variantAgent: AgentConfig = { ...richAgent, args: [RICH_VARIANT] }
    const p = new LoopAgentProvider(variantAgent, process.cwd(), null); providers.push(p)
    const a = captureEmit(); await p.runTurn('go', a.emit, new AbortController().signal)
    expect(a.cap.reasoning).toBe('thinking…')
    expect(a.cap.tools).toEqual([['t2', 'risky']])
    expect(a.cap.toolEnds[0]).toEqual(['t2', 'error', 'boom', 'boom'])
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

  it('respawns cleanly after an abort — the dying child does not clobber the next turn', async () => {
    // Turn 1 uses a hanging agent (cat never frames a reply); abort it. The old child is SIGINT'd
    // and dies asynchronously. Turn 2 lazily respawns a NEW child against the thin echo fixture on
    // the SAME provider; if the dying child's stale exit handler clobbered it, turn 2 would
    // spuriously reject instead of resolving with the echo.
    const p = new LoopAgentProvider(thinAgent, process.cwd(), null); providers.push(p)
    const ac = new AbortController()
    const turn1 = p.runTurn('first', captureEmit().emit, ac.signal)
    ac.abort()
    await expect(turn1).rejects.toMatchObject({ name: 'AbortError' })
    const b = captureEmit()
    await p.runTurn('second', b.emit, new AbortController().signal)
    expect(b.cap.text).toBe('echo: second')
  })
})
