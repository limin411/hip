import { describe, it, expect, vi } from 'vitest'
import type { AgentConfig } from '@hip/protocol'
import type { GraphEmit } from '../graph.js'
import type { AgentProvider, ExternalAgentHooks } from './types.js'
import type { ResolvedModel } from './registry.js'
import type { AttachmentPayload } from '../attachments.js'
import type { RunManagedAgentArgs } from '../internal-runner.js'
import { runManagedAgent } from '../internal-runner.js'
import { createAgentInvoker } from './invoker.js'

const runManagedAgentCalls: RunManagedAgentArgs[] = []

vi.mock('../internal-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../internal-runner.js')>()
  return {
    ...actual,
    runManagedAgent: vi.fn((args: RunManagedAgentArgs) => {
      runManagedAgentCalls.push(args)
      return Promise.resolve('managed')
    }),
  }
})

function collectingEmit() {
  const tokens: string[] = []
  const emit: GraphEmit = {
    token: (d) => tokens.push(d),
    reasoning: () => {},
    toolStarted: () => {},
    toolFinished: () => {},
    usage: () => {},
    planDelta: () => {},
    compaction: () => {},
  }
  return { emit, tokens }
}

class FakeProvider implements AgentProvider {
  disposed = false
  turnFs: any = null
  disposeDelayMs = 0
  constructor(private readonly script: (emit: GraphEmit) => Promise<void>) {}
  setTurnFsContext(ctx: any) { this.turnFs = ctx }
  async runTurn(_t: string, emit: GraphEmit, _s: AbortSignal, _h?: ExternalAgentHooks) {
    await this.script(emit)
  }
  async dispose() {
    if (this.disposeDelayMs > 0) await new Promise((r) => setTimeout(r, this.disposeDelayMs))
    this.disposed = true
  }
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

  it('sets turn FS context with parent permissionMode (chat) before runTurn', async () => {
    const provider = new FakeProvider(async () => {})
    const invoker = createAgentInvoker('/work/proj', {
      readAgents: () => [baseAgent],
      createProvider: () => provider,
      resolveModel: () => null,
    })
    await invoker.invoke(
      'echo',
      'hi',
      collectingEmit().emit,
      new AbortController().signal,
      undefined,
      { permissionMode: 'chat' },
    )
    expect(provider.turnFs).toMatchObject({
      cwd: '/work/proj',
      permissionMode: 'chat',
      readMaxBytes: expect.any(Number),
    })
  })

  it('disposes the provider even when runTurn throws', async () => {
    const provider = new FakeProvider(async () => { throw new Error('boom') })
    const invoker = createAgentInvoker('/tmp', { readAgents: () => [baseAgent], createProvider: () => provider, resolveModel: () => null })
    await expect(invoker.invoke('echo', 'hi', collectingEmit().emit, new AbortController().signal)).rejects.toThrow('boom')
    expect(provider.disposed).toBe(true)
  })

  it('awaits dispose before sequential invoke can start the next provider (no close race)', async () => {
    const order: string[] = []
    let n = 0
    const invoker = createAgentInvoker('/tmp', {
      readAgents: () => [baseAgent],
      createProvider: () => {
        const id = ++n
        order.push(`create:${id}`)
        const p = new FakeProvider(async (emit) => {
          order.push(`run:${id}`)
          emit.token(`t${id}`)
        })
        p.disposeDelayMs = 40
        const orig = p.dispose.bind(p)
        p.dispose = async () => {
          order.push(`dispose-start:${id}`)
          await orig()
          order.push(`dispose-end:${id}`)
        }
        return p
      },
      resolveModel: () => null,
    })
    await invoker.invoke('echo', 'a', collectingEmit().emit, new AbortController().signal)
    await invoker.invoke('echo', 'b', collectingEmit().emit, new AbortController().signal)
    // First dispose fully settles before second create/run
    expect(order).toEqual([
      'create:1', 'run:1', 'dispose-start:1', 'dispose-end:1',
      'create:2', 'run:2', 'dispose-start:2', 'dispose-end:2',
    ])
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

  it('forwards attachments to runInternal for internal agents', async () => {
    const seen: AttachmentPayload[] = []
    const internalAgent: AgentConfig = {
      id: 'vis', name: 'Vision', kind: 'internal', command: '', args: [],
      enabled: true, prompt: 'vision',
    }
    const invoker = createAgentInvoker('/work', {
      readAgents: () => [internalAgent],
      resolveModel: () => null,
      runInternal: async (a) => { seen.push(...(a.attachments ?? [])); return 'ok' },
    })
    const attachments: AttachmentPayload[] = [{ id: 'a1', name: 'x.png', mimeType: 'image/png', path: '/tmp/x.png' }]
    await invoker.invoke('vis', 'look', collectingEmit().emit, new AbortController().signal, undefined, undefined, attachments)
    expect(seen).toEqual(attachments)
  })

  it('forwards attachments through the default runInternal to runManagedAgent', async () => {
    const internalAgent: AgentConfig = {
      id: 'vis-default', name: 'Vision Default', kind: 'internal', command: '', args: [],
      enabled: true, prompt: 'vision default',
    }
    const invoker = createAgentInvoker('/work', {
      readAgents: () => [internalAgent],
      resolveModel: () => null,
      // no runInternal override; verify the default path delegates to runManagedAgent
    })
    const attachments: AttachmentPayload[] = [{ id: 'a2', name: 'y.png', mimeType: 'image/png', path: '/tmp/y.png' }]
    const text = await invoker.invoke('vis-default', 'look', collectingEmit().emit, new AbortController().signal, undefined, undefined, attachments)
    expect(text).toBe('managed')
    const managedCalls = runManagedAgentCalls.filter((c) => c.task === 'look')
    expect(managedCalls).toHaveLength(1)
    expect(managedCalls[0].attachments).toEqual(attachments)
  })

  it('passes explore allowedTools (read-only) into runInternal', async () => {
    let seen: string[] | undefined
    const exploreAgent: AgentConfig = {
      id: 'explore', name: 'Explore', kind: 'internal', command: '', args: [],
      enabled: true, prompt: 'explore only',
    }
    const invoker = createAgentInvoker('/work', {
      readAgents: () => [exploreAgent],
      resolveModel: () => null,
      runInternal: async (a) => {
        seen = a.allowedTools
        return 'ok'
      },
    })
    await invoker.invoke('explore', 'scan', collectingEmit().emit, new AbortController().signal)
    expect(seen).toEqual(
      expect.arrayContaining(['read_file', 'ls', 'glob', 'grep']),
    )
    expect(seen).not.toContain('write_file')
    expect(seen).not.toContain('run_script')
  })
})
