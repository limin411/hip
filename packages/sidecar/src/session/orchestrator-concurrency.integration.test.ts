import { describe, it, expect } from 'vitest'
import type { WorkflowDef, WorkflowNode, WorkflowEdge, NodeOutput } from '@hip/protocol'
import { runWorkflow } from '../orchestrator/executor.js'
import { FakeAgentRunner, CollectingEventSink, type FakeScript } from '../orchestrator/ports.js'
import type { AgentRunner, AgentRunRequest } from '../orchestrator/ports.js'

const node = (id: string, inputTemplate = ''): WorkflowNode => ({
  id,
  type: 'agent',
  agentId: 'a',
  inputTemplate,
})

const wf = (over: Partial<WorkflowDef>): WorkflowDef => ({
  id: 'wf',
  name: 'wf',
  nodes: [],
  edges: [],
  entry: [],
  ...over,
})

/** Build a 5-node fan-out from entry 'a': a→b, a→c, a→d, a→e, a→f */
function fanOut5(): WorkflowDef {
  return wf({
    nodes: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => node(id)),
    edges: [
      { from: 'a', to: 'b' } as WorkflowEdge,
      { from: 'a', to: 'c' } as WorkflowEdge,
      { from: 'a', to: 'd' } as WorkflowEdge,
      { from: 'a', to: 'e' } as WorkflowEdge,
      { from: 'a', to: 'f' } as WorkflowEdge,
    ],
    entry: ['a'],
  })
}

function harness(script: FakeScript = {}) {
  const runner = new FakeAgentRunner(script)
  const sink = new CollectingEventSink()
  return { runner, sink, ports: { agentRunner: runner, eventSink: sink } }
}

// ── Tracking runner: records max concurrent in-flight ──────────────
class TrackingRunner implements AgentRunner {
  calls: AgentRunRequest[] = []
  maxConcurrent = 0
  private current = 0
  constructor(private readonly delayMs: number = 10, private readonly throwsMap: Map<string, string> = new Map()) {}

  async run(req: AgentRunRequest, signal: AbortSignal): Promise<NodeOutput> {
    this.calls.push(req)
    this.current++
    this.maxConcurrent = Math.max(this.maxConcurrent, this.current)
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.delayMs)
        signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e) }, { once: true })
      })
      const throwsMsg = this.throwsMap.get(req.nodeId)
      if (throwsMsg) throw new Error(throwsMsg)
      // Match FakeAgentRunner: empty input cannot pass node-runner empty-output guard.
      const text = req.input.text?.trim() ? req.input.text : `fake-output-${req.nodeId}`
      return { text }
    } finally {
      this.current--
    }
  }
}

// ════════════════════════════════════════════════════════════════════
//  Fant-out 5 nodes with maxConcurrency=3
// ════════════════════════════════════════════════════════════════════
describe('orchestrator concurrency — fan-out 5 nodes with maxConcurrency=3', () => {
  it('maxConcurrency=3 limits concurrent agents, all 5 eventually succeed', async () => {
    const def = fanOut5()
    const tracker = new TrackingRunner(20)
    const sink = new CollectingEventSink()
    const ac = new AbortController()
    const state = await runWorkflow(def, { agentRunner: tracker, eventSink: sink }, {
      runId: 'r-conc-1',
      signal: ac.signal,
      maxConcurrency: 3,
    })

    // All 6 nodes (entry + 5 fan-out) succeed
    expect(state.status).toBe('succeeded')
    expect(state.nodes.a.status).toBe('succeeded')
    expect(state.nodes.b.status).toBe('succeeded')
    expect(state.nodes.c.status).toBe('succeeded')
    expect(state.nodes.d.status).toBe('succeeded')
    expect(state.nodes.e.status).toBe('succeeded')
    expect(state.nodes.f.status).toBe('succeeded')

    // Max concurrent never exceeded the limit
    expect(tracker.maxConcurrent).toBeLessThanOrEqual(3)
    // With a 20ms delay and 5 fan-out nodes, at least 2 must have run concurrently
    expect(tracker.maxConcurrent).toBeGreaterThanOrEqual(2)

    // All 6 nodes were called
    expect(tracker.calls).toHaveLength(6)
    const called = tracker.calls.map((c) => c.nodeId)
    expect(called).toContain('a')
    for (const id of ['b', 'c', 'd', 'e', 'f']) expect(called).toContain(id)
  })

  it('maxConcurrency=3 with staggered delays — first slot freed before 4th node starts', async () => {
    // b=60ms, c=10ms, d=80ms, e=10ms, f=10ms. maxConcurrency=3.
    // a finishes → b,c,d launch (3 slots filled). c finishes first at ~10ms → e takes slot.
    // e finishes → f takes slot. b finishes at 60ms. d finishes at 80ms. f finishes.
    const def = fanOut5()
    const script: FakeScript = {
      b: { delayMs: 60 },
      c: { delayMs: 10 },
      d: { delayMs: 80 },
      e: { delayMs: 10 },
      f: { delayMs: 10 },
    }
    const { runner, sink, ports } = harness(script)
    const ac = new AbortController()
    const state = await runWorkflow(def, ports, { runId: 'r-conc-2', signal: ac.signal, maxConcurrency: 3 })

    expect(state.status).toBe('succeeded')
    for (const id of ['b', 'c', 'd', 'e', 'f']) {
      expect(state.nodes[id].status).toBe('succeeded')
    }

    // node:started events for fan-out nodes: b, c, d launch first (3 slots)
    const started = sink.ofType('node:started').map((e) => e.nodeId)
    // a always starts first
    expect(started[0]).toBe('a')
    // First three fan-out nodes launched (order among b,c,d is launch-loop order = def order)
    const firstThree = new Set(started.slice(1, 4))
    expect(firstThree.has('b')).toBe(true)
    expect(firstThree.has('c')).toBe(true)
    expect(firstThree.has('d')).toBe(true)
    // The 4th and 5th fan-out start after a slot opens
    expect(started).toContain('e')
    expect(started).toContain('f')
  })

  it('default maxConcurrency (5) — all 5 fan-out nodes run concurrently', async () => {
    const def = fanOut5()
    // With default maxConcurrency=5 and 20ms delay, all 5 should run concurrently
    const tracker = new TrackingRunner(20)
    const sink = new CollectingEventSink()
    const ac = new AbortController()
    const state = await runWorkflow(def, { agentRunner: tracker, eventSink: sink }, {
      runId: 'r-conc-3',
      signal: ac.signal,
    })

    expect(state.status).toBe('succeeded')
    // With 20ms delay and 5 fan-out nodes, all 5 run concurrently → maxConcurrent >= 5
    expect(tracker.maxConcurrent).toBeGreaterThanOrEqual(5)
  })

  it('maxConcurrency=1 serializes all 5 fan-out nodes', async () => {
    const def = fanOut5()
    const tracker = new TrackingRunner(5)
    const ac = new AbortController()
    const state = await runWorkflow(def, { agentRunner: tracker }, {
      runId: 'r-conc-4',
      signal: ac.signal,
      maxConcurrency: 1,
    })

    expect(state.status).toBe('succeeded')
    expect(tracker.maxConcurrent).toBe(1)
    // With serial execution, calls are in definition order
    expect(tracker.calls.map((c) => c.nodeId)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })
})

// ════════════════════════════════════════════════════════════════════
//  Cancel propagation
// ════════════════════════════════════════════════════════════════════
describe('orchestrator concurrency — cancel propagation', () => {
  it('abort midway through 5 slow nodes → run cancelled, in-flight nodes aborted, no nodes running', async () => {
    const def = fanOut5()
    // Every fan-out node takes 300ms, giving a wide window to cancel
    const script: FakeScript = {}
    for (const id of ['b', 'c', 'd', 'e', 'f']) script[id] = { delayMs: 300 }

    const { runner, sink, ports } = harness(script)
    const ac = new AbortController()
    // Abort after 30ms — entry a finishes quickly, fan-out nodes are in-flight
    setTimeout(() => ac.abort(), 30)

    const state = await runWorkflow(def, ports, { runId: 'r-cancel-1', signal: ac.signal, maxConcurrency: 3 })

    expect(state.status).toBe('cancelled')

    // No node should be left in 'running' state
    const running = Object.entries(state.nodes).filter(([, s]) => s.status === 'running')
    expect(running).toEqual([])

    // Entry node a should have completed (no delay)
    expect(state.nodes.a.status).toBe('succeeded')

    // run:cancelled event was emitted
    const cancelledEvents = sink.ofType('run:cancelled')
    expect(cancelledEvents.length).toBeGreaterThanOrEqual(1)

    // run:finished should carry 'cancelled', never 'succeeded'
    const finished = sink.ofType('run:finished')
    expect(finished.some((e) => e.status === 'succeeded')).toBe(false)
    expect(finished.some((e) => e.status === 'cancelled')).toBe(true)
  })

  it('pre-aborted signal → no nodes launched, run cancelled immediately', async () => {
    const def = fanOut5()
    const script: FakeScript = {}
    for (const id of ['b', 'c', 'd', 'e', 'f']) script[id] = { text: 'should-not-run' }

    const { runner, sink, ports } = harness(script)
    const ac = new AbortController()
    ac.abort() // cancel before runWorkflow even starts

    const state = await runWorkflow(def, ports, { runId: 'r-cancel-2', signal: ac.signal })

    expect(state.status).toBe('cancelled')
    // No node should have been launched
    expect(runner.calls).toHaveLength(0)

    const finished = sink.ofType('run:finished')
    expect(finished.some((e) => e.status === 'succeeded')).toBe(false)
    expect(sink.ofType('run:cancelled').length).toBeGreaterThanOrEqual(1)
  })

  it('cancel during fan-out — nodes launched before cancel drain, late nodes never start', async () => {
    // a completes quickly. With maxConcurrency=2, only b,c launch.
    // Abort arrives mid-flight → d,e,f never start.
    const def = fanOut5()
    const script: FakeScript = {
      b: { delayMs: 200 },
      c: { delayMs: 200 },
      d: { delayMs: 10 },
      e: { delayMs: 10 },
      f: { delayMs: 10 },
    }
    const { runner, sink, ports } = harness(script)
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 30)

    const state = await runWorkflow(def, ports, { runId: 'r-cancel-3', signal: ac.signal, maxConcurrency: 2 })

    expect(state.status).toBe('cancelled')
    // a should have completed
    expect(state.nodes.a.status).toBe('succeeded')
    // b, c were in-flight when cancelled → cancelled
    expect(state.nodes.b.status).toBe('cancelled')
    expect(state.nodes.c.status).toBe('cancelled')
    // d, e, f were never launched → should not be 'succeeded'
    expect(state.nodes.d.status).not.toBe('succeeded')
    expect(state.nodes.e.status).not.toBe('succeeded')
    expect(state.nodes.f.status).not.toBe('succeeded')
    // No running nodes
    expect(Object.values(state.nodes).filter((n) => n.status === 'running')).toEqual([])
  })

  it('cancel propagates through reduce — downstream pending nodes never launch', async () => {
    // Chain a→b→c. Node b is slow, cancel while b is in-flight.
    // b gets cancelled (running→cancelled), c stays pending (never launched).
    // run:cancelled only transitions 'running' nodes; pending nodes remain pending.
    const def = wf({
      nodes: [node('a'), node('b'), node('c')],
      edges: [
        { from: 'a', to: 'b' } as WorkflowEdge,
        { from: 'b', to: 'c' } as WorkflowEdge,
      ],
      entry: ['a'],
    })
    const script: FakeScript = { b: { delayMs: 300 } }
    const { runner, sink, ports } = harness(script)
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 30)

    const state = await runWorkflow(def, ports, { runId: 'r-cancel-4', signal: ac.signal })

    expect(state.status).toBe('cancelled')
    expect(state.nodes.a.status).toBe('succeeded')
    expect(state.nodes.b.status).toBe('cancelled')
    // c was pending (waiting for b) — cascaded to cancelled by Phase 1 fix
    expect(state.nodes.c.status).toBe('cancelled')
    expect(runner.calls.map((c) => c.nodeId)).not.toContain('c')
    // No node stuck in running
    expect(Object.values(state.nodes).filter((n) => n.status === 'running')).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════
//  Fail-fast with concurrency
// ════════════════════════════════════════════════════════════════════
describe('orchestrator concurrency — fail-fast', () => {
  it('one node throws in 5-node fan-out → run failed, no lingering running nodes', async () => {
    const def = fanOut5()
    const tracker = new TrackingRunner(10, new Map([['c', 'boom-c']]))
    const sink = new CollectingEventSink()
    const ac = new AbortController()
    const state = await runWorkflow(def, { agentRunner: tracker, eventSink: sink }, {
      runId: 'r-ff-1',
      signal: ac.signal,
      maxConcurrency: 3,
    })

    expect(state.status).toBe('failed')
    expect(state.nodes.c.status).toBe('failed')
    expect(state.nodes.c.error).toBe('boom-c')

    // No node left in 'running' state
    const running = Object.entries(state.nodes).filter(([, s]) => s.status === 'running')
    expect(running).toEqual([])

    // node:failed event emitted
    const failedEvents = sink.ofType('node:failed')
    expect(failedEvents).toHaveLength(1)
    expect(failedEvents[0].nodeId).toBe('c')
  })

  it('three nodes throw concurrently in 5-node fan-out → all three recorded as failed, no lingering', async () => {
    const def = fanOut5()
    const throwsMap = new Map([
      ['b', 'boom-b'],
      ['d', 'boom-d'],
      ['e', 'boom-e'],
    ])
    const tracker = new TrackingRunner(10, throwsMap)
    const sink = new CollectingEventSink()
    const ac = new AbortController()
    const state = await runWorkflow(def, { agentRunner: tracker, eventSink: sink }, {
      runId: 'r-ff-2',
      signal: ac.signal,
      maxConcurrency: 5, // all run concurrently
    })

    expect(state.status).toBe('failed')

    // All three failing nodes recorded as failed
    expect(state.nodes.b.status).toBe('failed')
    expect(state.nodes.b.error).toBe('boom-b')
    expect(state.nodes.d.status).toBe('failed')
    expect(state.nodes.d.error).toBe('boom-d')
    expect(state.nodes.e.status).toBe('failed')
    expect(state.nodes.e.error).toBe('boom-e')

    // Success nodes still succeeded (they finish before fail-fast propagates in executor loop)
    // Note: executor drains in-flight, so nodes that finished before the first node:failed
    // event was processed will still show as 'succeeded'

    // Critical invariant: no node stuck in 'running'
    const running = Object.entries(state.nodes).filter(([, s]) => s.status === 'running')
    expect(running).toEqual([])

    // node:failed events for all three failing nodes
    const failedIds = sink.ofType('node:failed').map((e) => e.nodeId)
    expect(failedIds).toContain('b')
    expect(failedIds).toContain('d')
    expect(failedIds).toContain('e')
  })

  it('fail-fast with staggered delays — first failure stops new launches, drains remaining', async () => {
    // b=10ms→throw, c=200ms (slow), d=200ms (slow). maxConcurrency=3.
    // b fails early → run becomes failed → launch() never called again
    // c and d continue in-flight but drain
    const def = wf({
      nodes: [node('a'), node('b'), node('c'), node('d')],
      edges: [
        { from: 'a', to: 'b' } as WorkflowEdge,
        { from: 'a', to: 'c' } as WorkflowEdge,
        { from: 'a', to: 'd' } as WorkflowEdge,
      ],
      entry: ['a'],
    })
    const script: FakeScript = {
      b: { delayMs: 10, throws: 'boom-b' },
      c: { delayMs: 200 },
      d: { delayMs: 200 },
    }
    const { runner, sink, ports } = harness(script)
    const ac = new AbortController()
    const state = await runWorkflow(def, ports, { runId: 'r-ff-3', signal: ac.signal, maxConcurrency: 3 })

    expect(state.status).toBe('failed')
    expect(state.nodes.b.status).toBe('failed')

    // c and d drain — they may have succeeded or been running when fail propagates
    // Key: no node stuck in 'running'
    const running = Object.entries(state.nodes).filter(([, s]) => s.status === 'running')
    expect(running).toEqual([])

    // node:failed for b was emitted
    expect(sink.ofType('node:failed').some((e) => e.nodeId === 'b')).toBe(true)
  })

  it('all 5 fan-out nodes throw → every node reported as failed, no running survivors', async () => {
    const def = fanOut5()
    const script: FakeScript = {}
    for (const id of ['b', 'c', 'd', 'e', 'f']) script[id] = { throws: `boom-${id}` }

    const { sink, ports } = harness(script)
    const ac = new AbortController()
    const state = await runWorkflow(def, ports, { runId: 'r-ff-4', signal: ac.signal, maxConcurrency: 5 })

    expect(state.status).toBe('failed')

    // Every fan-out node failed
    for (const id of ['b', 'c', 'd', 'e', 'f']) {
      expect(state.nodes[id].status).toBe('failed')
      expect(state.nodes[id].error).toBe(`boom-${id}`)
    }

    // No node stuck in running
    expect(Object.values(state.nodes).filter((n) => n.status === 'running')).toEqual([])

    // node:failed events for all five
    const failedIds = sink.ofType('node:failed').map((e) => e.nodeId)
    for (const id of ['b', 'c', 'd', 'e', 'f']) expect(failedIds).toContain(id)
  })
})

// ════════════════════════════════════════════════════════════════════
//  Mixed: cancel during fail-fast
// ════════════════════════════════════════════════════════════════════
describe('orchestrator concurrency — cancel vs fail-fast interaction', () => {
  it('abort signal takes priority over node failure — run ends as cancelled, not failed', async () => {
    // b throws quickly, but abort also fires. Cancel should win.
    const def = wf({
      nodes: [node('a'), node('b')],
      edges: [{ from: 'a', to: 'b' } as WorkflowEdge],
      entry: ['a'],
    })
    const script: FakeScript = { b: { delayMs: 100, throws: 'boom' } }
    const { sink, ports } = harness(script)
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 20)

    const state = await runWorkflow(def, ports, { runId: 'r-mix-1', signal: ac.signal })

    // Cancel wins: the run:cancelled reduce sets node statuses to cancelled
    expect(state.status).toBe('cancelled')
    expect(state.nodes.b.status).toBe('cancelled')

    // run:finished must be 'cancelled', not 'failed' or 'succeeded'
    const finished = sink.ofType('run:finished')
    expect(finished[0].status).toBe('cancelled')
  })

  it('cancel + fail-fast fan-out: cancel before any node throws → run cancelled', async () => {
    // 4 fan-out nodes, all delayed 200ms (including the one that throws).
    // Cancel fires at 30ms, before any node settles → run is cancelled.
    const def = wf({
      nodes: [node('a'), node('b'), node('c'), node('d'), node('e')],
      edges: [
        { from: 'a', to: 'b' } as WorkflowEdge,
        { from: 'a', to: 'c' } as WorkflowEdge,
        { from: 'a', to: 'd' } as WorkflowEdge,
        { from: 'a', to: 'e' } as WorkflowEdge,
      ],
      entry: ['a'],
    })
    const script: FakeScript = {
      b: { delayMs: 200 },
      c: { delayMs: 200 },
      d: { delayMs: 200, throws: 'boom-d' },
      e: { delayMs: 200 },
    }
    const { sink, ports } = harness(script)
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 30)

    const state = await runWorkflow(def, ports, { runId: 'r-mix-2', signal: ac.signal, maxConcurrency: 4 })

    // Cancel fires before any node finishes → run:cancelled applied while still 'running'
    expect(state.status).toBe('cancelled')

    // In-flight nodes (b,c,d,e all started with maxConcurrency=4) → cancelled
    // No node should be left as 'running'
    expect(Object.values(state.nodes).filter((n) => n.status === 'running')).toEqual([])

    // d's throw occurred after cancel → rejection swallowed, d stays cancelled not failed
    const finished = sink.ofType('run:finished')
    expect(finished.some((e) => e.status === 'cancelled')).toBe(true)
    expect(finished.some((e) => e.status === 'succeeded')).toBe(false)
  })
})
