import { describe, it, expect } from 'vitest'
import type { AgentRunRequest } from './ports.js'
import {
  FakeAgentRunner,
  InMemoryWorkflowStore,
  CollectingEventSink,
} from './ports.js'
import type { RunState, WorkflowDef, OrchestratorEvent } from '@hip/protocol'

function reqFor(nodeId: string, text = 'hello'): AgentRunRequest {
  return { runId: 'run-1', nodeId, agentId: 'agent-1', input: { text } }
}

describe('FakeAgentRunner', () => {
  it('① 默认回显输入并记录 calls', async () => {
    const runner = new FakeAgentRunner()
    const out = await runner.run(reqFor('n1', 'echo-me'), new AbortController().signal)
    expect(out).toEqual({ text: 'echo-me', data: undefined })
    expect(runner.calls).toHaveLength(1)
    expect(runner.calls[0]).toMatchObject({ runId: 'run-1', nodeId: 'n1', agentId: 'agent-1' })
  })

  it('① 脚本可覆盖 text/data', async () => {
    const runner = new FakeAgentRunner({ n1: { text: 'scripted', data: { k: 1 } } })
    const out = await runner.run(reqFor('n1', 'ignored'), new AbortController().signal)
    expect(out).toEqual({ text: 'scripted', data: { k: 1 } })
  })

  it('② 注入 throws 时 reject', async () => {
    const runner = new FakeAgentRunner({ n1: { throws: 'boom' } })
    await expect(runner.run(reqFor('n1'), new AbortController().signal)).rejects.toThrow('boom')
  })

  it('③ delayMs 期间 abort → reject AbortError', async () => {
    const runner = new FakeAgentRunner({ n1: { delayMs: 1000 } })
    const ac = new AbortController()
    const p = runner.run(reqFor('n1'), ac.signal)
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('③ delayMs 正常完成(未 abort)→ 回显', async () => {
    const runner = new FakeAgentRunner({ n1: { delayMs: 1 } })
    const out = await runner.run(reqFor('n1', 'delayed'), new AbortController().signal)
    expect(out.text).toBe('delayed')
  })

  it('③ 调用前已 abort(delayMs 路径)→ 立即 reject AbortError,不空等', async () => {
    const runner = new FakeAgentRunner({ n1: { delayMs: 1000 } })
    const ac = new AbortController()
    ac.abort()
    await expect(runner.run(reqFor('n1'), ac.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('③ 调用前已 abort(无 delayMs 路径)→ 立即 reject AbortError', async () => {
    const runner = new FakeAgentRunner({ n1: { text: 'should-not-return' } })
    const ac = new AbortController()
    ac.abort()
    await expect(runner.run(reqFor('n1'), ac.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('InMemoryWorkflowStore', () => {
  const def: WorkflowDef = {
    id: 'wf-1',
    name: 'WF',
    nodes: [{ id: 'n1', type: 'agent', agentId: 'a1', inputTemplate: '{{input}}' }],
    edges: [],
    entry: ['n1'],
  }
  const run: RunState = {
    runId: 'run-1',
    workflowId: 'wf-1',
    status: 'pending',
    nodes: { n1: { status: 'pending' } },
  }

  it('④ def save/load 往返', async () => {
    const store = new InMemoryWorkflowStore()
    expect(await store.loadDef('wf-1')).toBeNull()
    await store.saveDef(def)
    expect(await store.loadDef('wf-1')).toEqual(def)
  })

  it('④ run save/load 往返', async () => {
    const store = new InMemoryWorkflowStore()
    expect(await store.loadRun('run-1')).toBeNull()
    await store.saveRun(run)
    expect(await store.loadRun('run-1')).toEqual(run)
  })

  it('④ 返回的是克隆:改返回值不影响存储', async () => {
    const store = new InMemoryWorkflowStore()
    await store.saveRun(run)
    const loaded = await store.loadRun('run-1')
    expect(loaded).not.toBeNull()
    loaded!.status = 'failed'
    loaded!.nodes.n1.status = 'failed'
    const again = await store.loadRun('run-1')
    expect(again!.status).toBe('pending')
    expect(again!.nodes.n1.status).toBe('pending')
  })

  it('④ 入参也被克隆:存入后改原对象不影响存储', async () => {
    const store = new InMemoryWorkflowStore()
    const mutable: RunState = structuredClone(run)
    await store.saveRun(mutable)
    mutable.status = 'failed'
    const loaded = await store.loadRun('run-1')
    expect(loaded!.status).toBe('pending')
  })
})

describe('CollectingEventSink', () => {
  it('⑤ 收集事件并按 type 过滤', () => {
    const sink = new CollectingEventSink()
    const events: OrchestratorEvent[] = [
      { type: 'run:started' },
      { type: 'node:started', nodeId: 'n1' },
      { type: 'node:succeeded', nodeId: 'n1', output: { text: 'ok' } },
      { type: 'node:started', nodeId: 'n2' },
      { type: 'run:finished', status: 'succeeded' },
    ]
    for (const e of events) sink.emit(e)
    expect(sink.events).toHaveLength(5)

    const started = sink.ofType('node:started')
    expect(started).toHaveLength(2)
    expect(started.map((e) => e.nodeId)).toEqual(['n1', 'n2'])

    const finished = sink.ofType('run:finished')
    expect(finished).toHaveLength(1)
    expect(finished[0].status).toBe('succeeded')

    expect(sink.ofType('node:failed')).toHaveLength(0)
  })
})
