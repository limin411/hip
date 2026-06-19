import { describe, it, expect } from 'vitest'
import type { AgentConfig } from '@hip/protocol'
import type { GraphEmit } from '../graph.js'
import type { AgentProvider, ExternalAgentHooks } from './types.js'
import type { ResolvedModel } from './registry.js'
import { createAgentInvoker } from './invoker.js'

function collectingEmit() {
  const tokens: string[] = []
  const emit: GraphEmit = {
    token: (d) => tokens.push(d),
    reasoning: () => {},
    toolStarted: () => {},
    toolFinished: () => {},
    usage: () => {},
  }
  return { emit, tokens }
}

class FakeProvider implements AgentProvider {
  disposed = false
  constructor(private readonly script: (emit: GraphEmit) => Promise<void>) {}
  async runTurn(_t: string, emit: GraphEmit, _s: AbortSignal, _h?: ExternalAgentHooks) {
    await this.script(emit)
  }
  dispose() { this.disposed = true }
}

const baseAgent: AgentConfig = {
  id: 'echo', name: 'Echo', kind: 'acp', command: 'x', args: [],
  enabled: true,
}

describe('createAgentInvoker', () => {
  it('streams tokens through emit and returns the accumulated text', async () => {
    const provider = new FakeProvider(async (emit) => { emit.token('he'); emit.token('llo') })
    const invoker = createAgentInvoker('/tmp', {
      readAgents: () => [baseAgent],
      createProvider: () => provider,
      resolveModel: () => null,
    })
    const { emit, tokens } = collectingEmit()
    const text = await invoker.invoke('echo', 'hi', emit, new AbortController().signal)
    expect(tokens.join('')).toBe('hello')
    expect(text).toBe('hello')
    expect(provider.disposed).toBe(true)
  })

  it('errors for an unknown agent', async () => {
    const invoker = createAgentInvoker('/tmp', { readAgents: () => [], createProvider: () => { throw new Error('nope') }, resolveModel: () => null })
    await expect(invoker.invoke('missing', 'hi', collectingEmit().emit, new AbortController().signal))
      .rejects.toThrow(/unknown or disabled agent: missing/)
  })

  it('errors for a present-but-disabled agent (and never creates a provider)', async () => {
    let created = false
    const invoker = createAgentInvoker('/tmp', {
      readAgents: () => [{ ...baseAgent, enabled: false }],
      createProvider: () => { created = true; throw new Error('should not run') },
      resolveModel: () => null,
    })
    await expect(invoker.invoke('echo', 'hi', collectingEmit().emit, new AbortController().signal))
      .rejects.toThrow(/unknown or disabled agent: echo/)
    expect(created).toBe(false)
  })

  it('never resolves a model for an ACP agent (rollback)', async () => {
    // Model rollback: ACP agents self-manage; hip must not resolve/push a model to them.
    const seen: Array<ResolvedModel | null> = []
    let resolved = false
    const model: ResolvedModel = { providerID: 'p', modelID: 'm', baseURL: 'u' }
    const invoker = createAgentInvoker('/tmp', {
      readAgents: () => [baseAgent],
      resolveModel: () => { resolved = true; return model },
      createProvider: (_a, _cwd, m) => { seen.push(m); return new FakeProvider(async () => {}) },
    })
    await invoker.invoke('echo', 'hi', collectingEmit().emit, new AbortController().signal)
    expect(seen).toEqual([null])
    expect(resolved).toBe(false)
  })

  it('forwards the same hooks reference to the provider turn', async () => {
    let seenHooks: ExternalAgentHooks | undefined
    const provider = new FakeProvider(async () => {})
    provider.runTurn = async (_t, _emit, _s, h) => { seenHooks = h }
    const invoker = createAgentInvoker('/tmp', { readAgents: () => [baseAgent], createProvider: () => provider, resolveModel: () => null })
    const hooks: ExternalAgentHooks = { requestPermission: async () => ({ cancelled: true }), configOptions: () => {} }
    await invoker.invoke('echo', 'hi', collectingEmit().emit, new AbortController().signal, hooks)
    expect(seenHooks).toBe(hooks)
  })

  it('disposes the provider even when runTurn throws', async () => {
    const provider = new FakeProvider(async () => { throw new Error('boom') })
    const invoker = createAgentInvoker('/tmp', { readAgents: () => [baseAgent], createProvider: () => provider, resolveModel: () => null })
    await expect(invoker.invoke('echo', 'hi', collectingEmit().emit, new AbortController().signal)).rejects.toThrow('boom')
    expect(provider.disposed).toBe(true)
  })

  it('routes an internal agent to runInternal with the resolved model + persona, returns its text', async () => {
    const seen: { agentId?: string; task?: string; resolved?: unknown; prompt?: string } = {}
    const internalAgent: AgentConfig = {
      id: 'rev', name: 'Reviewer', kind: 'internal', command: '', args: [],
      enabled: true, prompt: 'review carefully',
      boundModel: { providerID: 'p', modelID: 'm' },
    }
    const invoker = createAgentInvoker('/work', {
      readAgents: () => [internalAgent],
      resolveModel: () => ({ providerID: 'p', modelID: 'm', baseURL: 'u' }),
      createProvider: () => { throw new Error('internal must NOT build a provider') },
      runInternal: async (a) => { seen.agentId = a.agentId; seen.task = a.task; seen.resolved = a.resolved; seen.prompt = a.prompt; a.emit.token('R'); return 'reviewed' },
    })
    const { emit, tokens } = collectingEmit()
    const text = await invoker.invoke('rev', 'do review', emit, new AbortController().signal)
    expect(text).toBe('reviewed')
    expect(tokens.join('')).toBe('R')
    expect(seen).toMatchObject({ agentId: 'rev', task: 'do review', resolved: { providerID: 'p', modelID: 'm', baseURL: 'u' }, prompt: 'review carefully' })
  })

  it('passes resolved=null for an internal agent with no bound model', async () => {
    let seenResolved: unknown = 'unset'
    const internalAgent: AgentConfig = {
      id: 'sum', name: 'Summarizer', kind: 'internal', command: '', args: [],
      enabled: true, prompt: 'summarize',
    }
    const invoker = createAgentInvoker('/work', {
      readAgents: () => [internalAgent],
      resolveModel: () => null,
      runInternal: async (a) => { seenResolved = a.resolved; return 'ok' },
    })
    await invoker.invoke('sum', 't', collectingEmit().emit, new AbortController().signal)
    expect(seenResolved).toBeNull()
  })
})
