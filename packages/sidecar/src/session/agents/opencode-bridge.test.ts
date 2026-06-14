import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { chmodSync } from 'node:fs'
import type { AgentConfig } from '@hip/protocol'
import { LoopAgentProvider } from './loop-provider.js'
import type { GraphEmit } from '../graph.js'
import type { ResolvedModel } from './registry.js'

// Drives the real scripts/opencode-bridge.mjs through hip's real LoopAgentProvider,
// but points it at a mock `opencode` (no paid LLM call). Proves the Custom CLI
// agent → bridge → opencode wiring satisfies hip's thin turn-loop contract.
const here = dirname(fileURLToPath(import.meta.url))
const MOCK = join(here, '__fixtures__', 'mock-opencode.mjs')
const BRIDGE = resolve(process.cwd(), 'scripts/opencode-bridge.mjs')

beforeAll(() => { chmodSync(MOCK, 0o755) })

function cap(): { emit: GraphEmit; out: { text: string } } {
  const out = { text: '' }
  const emit: GraphEmit = {
    token: (d) => { out.text += d },
    reasoning: () => {},
    toolStarted: () => {},
    toolFinished: () => {},
    usage: () => {},
  }
  return { emit, out }
}

const providers: LoopAgentProvider[] = []
afterEach(() => { for (const p of providers.splice(0)) p.dispose() })

function bridgeAgent(extra: Partial<AgentConfig> = {}): AgentConfig {
  const { env, ...rest } = extra
  return {
    id: 'oc', name: 'OpenCode', kind: 'custom', command: 'node', args: [BRIDGE],
    transport: 'thin', acceptsModelConfig: false, enabled: true,
    env: { OPENCODE_BIN: MOCK, ...(env ?? {}) }, ...rest,
  }
}

describe('opencode bridge (via hip LoopAgentProvider, mock opencode)', () => {
  it('bridges a thin turn to `opencode run` and streams the reply', async () => {
    const p = new LoopAgentProvider(bridgeAgent(), process.cwd(), null); providers.push(p)
    const a = cap()
    await p.runTurn('hello', a.emit, new AbortController().signal)
    expect(a.out.text).toContain('reply to: hello')
    expect(a.out.text).not.toContain('[continue]')
  })

  it('is stateless by default — no --continue, even on later turns', async () => {
    const p = new LoopAgentProvider(bridgeAgent(), process.cwd(), null); providers.push(p)
    const a = cap()
    await p.runTurn('first', a.emit, new AbortController().signal)
    const b = cap()
    await p.runTurn('second', b.emit, new AbortController().signal)
    expect(b.out.text).toContain('reply to: second')
    expect(b.out.text).not.toContain('[continue]')
  })

  it('passes --continue on later turns when OPENCODE_BRIDGE_CONTINUE=1', async () => {
    const p = new LoopAgentProvider(bridgeAgent({ env: { OPENCODE_BRIDGE_CONTINUE: '1' } }), process.cwd(), null)
    providers.push(p)
    const a = cap()
    await p.runTurn('first', a.emit, new AbortController().signal)
    expect(a.out.text).not.toContain('[continue]') // first turn never continues
    const b = cap()
    await p.runTurn('second', b.emit, new AbortController().signal)
    expect(b.out.text).toContain('[continue]')
  })

  it('forwards extra flags from the args field (e.g. --pure) and treats --continue as the bridge flag', async () => {
    const p = new LoopAgentProvider(
      bridgeAgent({ args: [BRIDGE, '--pure', '--continue'] }),
      process.cwd(),
      null,
    )
    providers.push(p)
    const a = cap()
    await p.runTurn('first', a.emit, new AbortController().signal)
    expect(a.out.text).toContain('[pure]') // --pure passed through to opencode run
    expect(a.out.text).not.toContain('[continue]') // first turn never continues
    const b = cap()
    await p.runTurn('second', b.emit, new AbortController().signal)
    expect(b.out.text).toContain('[pure]')
    expect(b.out.text).toContain('[continue]') // --continue from args enables continuity
  })

  it('forwards the pushed model as `-m provider/model` when acceptsModelConfig', async () => {
    const model: ResolvedModel = { providerID: 'deepseek', modelID: 'deepseek-chat', baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk' }
    const p = new LoopAgentProvider(
      bridgeAgent({ acceptsModelConfig: true, boundModel: { providerID: 'deepseek', modelID: 'deepseek-chat' } }),
      process.cwd(),
      model,
    )
    providers.push(p)
    const a = cap()
    await p.runTurn('hi', a.emit, new AbortController().signal)
    expect(a.out.text).toContain('[model=deepseek/deepseek-chat]')
  })
})
