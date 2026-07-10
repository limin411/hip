import { describe, it, expect } from 'vitest'
import type { WorkflowDef } from '@hip/protocol'
import { launchResolvedNode } from './node-runner.js'
import { FakeAgentRunner, CollectingEventSink } from './ports.js'
import { registerGate } from './gates/index.js'
import type { VerificationGate } from './verification-gate.js'

describe('launchResolvedNode', () => {
  it('runs agent nodes via agentRunner', async () => {
    const runner = new FakeAgentRunner({ a: { text: 'hello' } })
    const result = await launchResolvedNode(
      { type: 'agent', id: 'a', agentId: 'worker', inputTemplate: '{{input}}' },
      { agentRunner: runner, eventSink: new CollectingEventSink() },
      {
        runId: 'r1',
        signal: new AbortController().signal,
        input: { text: 'in' },
      },
    )
    expect(result.ok).toBe(true)
    expect(result.out?.text).toBe('hello')
  })

  it('runs gate nodes via registered VerificationGate', async () => {
    const gate: VerificationGate = {
      kind: 'always-pass-test',
      description: 'test',
      async run() {
        return { passed: true, failures: [], suggestions: [], durationMs: 1 }
      },
    }
    registerGate(gate)
    const result = await launchResolvedNode(
      { type: 'gate', id: 'g1', gateKind: 'always-pass-test' },
      { agentRunner: new FakeAgentRunner(), eventSink: new CollectingEventSink() },
      {
        runId: 'r1',
        signal: new AbortController().signal,
        input: { text: '' },
        cwd: '/tmp',
      },
    )
    expect(result.ok).toBe(true)
    expect(result.out?.text).toContain('passed')
  })

  it('fails the node when gate does not pass', async () => {
    const gate: VerificationGate = {
      kind: 'always-fail-test',
      description: 'test',
      async run() {
        return {
          passed: false,
          failures: [{ message: 'lint error', severity: 'error' }],
          suggestions: [],
          durationMs: 1,
        }
      },
    }
    registerGate(gate)
    const result = await launchResolvedNode(
      { type: 'gate', id: 'g1', gateKind: 'always-fail-test' },
      { agentRunner: new FakeAgentRunner(), eventSink: new CollectingEventSink() },
      {
        runId: 'r1',
        signal: new AbortController().signal,
        input: { text: '' },
      },
    )
    expect(result.ok).toBe(false)
    expect(result.err).toContain('lint error')
  })

  it('rejects unsupported node types', async () => {
    const result = await launchResolvedNode(
      { type: 'human', id: 'h1', question: 'ok?' } as WorkflowDef['nodes'][number],
      { agentRunner: new FakeAgentRunner() },
      {
        runId: 'r1',
        signal: new AbortController().signal,
        input: { text: '' },
      },
    )
    expect(result.ok).toBe(false)
    expect(result.err).toContain('Unsupported')
  })
})
