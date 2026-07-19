import { describe, it, expect } from 'vitest'
import type { Message } from '@hip/protocol'
import { groupByAgent, groupAllAgents } from './turnAgents'

function msg(over: Partial<Message>): Message {
  return { id: 't1', role: 'assistant', content: '', timestamp: 0, ...over }
}

describe('groupByAgent', () => {
  it('merges timeline reasoning/tools with run taskInput/output/timing', () => {
    const m = msg({
      timeline: [
        { kind: 'reasoning', stepSeq: 0, agentId: 'planner-1', role: 'planner', content: 'thinking' },
        { kind: 'tool', stepSeq: 1, agentId: 'planner-1', role: 'planner', callId: 'c1' },
      ],
      toolCalls: [{ callId: 'c1', agentId: 'planner-1', name: 'read_file', input: '{}', status: 'finished', seq: 1 }],
      agentRuns: [{ agentId: 'planner-1', role: 'planner', output: 'the plan', startedAt: 1000, finishedAt: 3500, seq: 0, taskInput: 'plan it', parentAgentId: 'supervisor', messageId: 't1' }],
    })
    const [a] = groupByAgent(m, false)
    expect(a).toMatchObject({ agentId: 'planner-1', role: 'planner', reasoning: 'thinking', taskInput: 'plan it', parentAgentId: 'supervisor', output: 'the plan', status: 'done', elapsedMs: 2500 })
    expect(a.tools).toHaveLength(1)
  })

  it('includes an output-only agent that has a run but no timeline steps', () => {
    const m = msg({
      timeline: [{ kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'plan' }],
      agentRuns: [
        { agentId: 'supervisor', role: 'supervisor', output: 'answer', startedAt: 0, finishedAt: 9, seq: 0, messageId: 't1' },
        { agentId: 'reviewer-1', role: 'reviewer', output: 'looks good', startedAt: 5, finishedAt: 8, seq: 1, taskInput: 'review', parentAgentId: 'supervisor', messageId: 't1' },
      ],
    })
    const ids = groupByAgent(m, false).map((a) => a.agentId)
    expect(ids).toContain('reviewer-1')
    expect(groupByAgent(m, false).find((a) => a.agentId === 'reviewer-1')!.output).toBe('looks good')
  })

  it('status is running only while live and the run is unfinished', () => {
    const m = msg({
      timeline: [{ kind: 'reasoning', stepSeq: 0, agentId: 'coder-1', role: 'coder', content: 'x' }],
      agentRuns: [{ agentId: 'coder-1', role: 'coder', output: '', startedAt: 1000, finishedAt: null, seq: 0, messageId: 't1' }],
    })
    expect(groupByAgent(m, true)[0].status).toBe('running')
    expect(groupByAgent(m, false)[0].status).toBe('done') // not live → done even if unfinished
  })

  it('threads a dispatched subagent run with its parentAgentId and role (SubAgentCard contract)', () => {
    const m = msg({
      timeline: [{ kind: 'reasoning', stepSeq: 0, agentId: 'subagent-1', role: 'subagent', content: 'thinking' }],
      agentRuns: [{ agentId: 'subagent-1', role: 'subagent', output: 'done', startedAt: 0, finishedAt: 1, seq: 0, taskInput: 'do it', parentAgentId: 'supervisor', messageId: 't1', name: 'Explore' }],
      toolCalls: [],
    })
    const sub = groupByAgent(m, false).find((a) => a.agentId === 'subagent-1')
    expect(sub?.parentAgentId).toBe('supervisor')
    expect(sub?.role).toBe('subagent')
    expect(sub?.name).toBe('Explore')
  })
})

describe('groupAllAgents', () => {
  it('3 assistant messages with agent activity → 3 GroupedTurns with turnIndex 1,2,3', () => {
    const messages = [
      msg({ id: 'm1', timeline: [{ kind: 'reasoning', stepSeq: 0, agentId: 'a1', role: 'supervisor', content: 'think1' }] }),
      msg({ id: 'm2', timeline: [{ kind: 'reasoning', stepSeq: 0, agentId: 'a1', role: 'supervisor', content: 'think2' }] }),
      msg({ id: 'm3', timeline: [{ kind: 'reasoning', stepSeq: 0, agentId: 'a1', role: 'supervisor', content: 'think3' }] }),
    ]
    const turns = groupAllAgents(messages, 'idle')
    expect(turns).toHaveLength(3)
    expect(turns[0]).toMatchObject({ messageId: 'm1', turnIndex: 1 })
    expect(turns[1]).toMatchObject({ messageId: 'm2', turnIndex: 2 })
    expect(turns[2]).toMatchObject({ messageId: 'm3', turnIndex: 3 })
  })

  it('2 assistant messages with empty timelines → 0 GroupedTurns', () => {
    const messages = [
      msg({ id: 'm1' }),
      msg({ id: 'm2' }),
    ]
    const turns = groupAllAgents(messages, 'idle')
    expect(turns).toHaveLength(0)
  })

  it("sessionStatus='running' + last assistant has agentRuns with finishedAt=null → last GroupedTurn agents have status='running'", () => {
    const messages = [
      msg({
        id: 'm1',
        timeline: [{ kind: 'reasoning', stepSeq: 0, agentId: 'coder-1', role: 'coder', content: 'x' }],
        agentRuns: [{ agentId: 'coder-1', role: 'coder', output: '', startedAt: 1000, finishedAt: null, seq: 0, messageId: 'm1' }],
      }),
    ]
    const turns = groupAllAgents(messages, 'running')
    expect(turns).toHaveLength(1)
    expect(turns[0].agents[0].status).toBe('running')
  })

  it("sessionStatus='idle' + same data → last GroupedTurn agents have status='done'", () => {
    const messages = [
      msg({
        id: 'm1',
        timeline: [{ kind: 'reasoning', stepSeq: 0, agentId: 'coder-1', role: 'coder', content: 'x' }],
        agentRuns: [{ agentId: 'coder-1', role: 'coder', output: '', startedAt: 1000, finishedAt: null, seq: 0, messageId: 'm1' }],
      }),
    ]
    const turns = groupAllAgents(messages, 'idle')
    expect(turns).toHaveLength(1)
    expect(turns[0].agents[0].status).toBe('done')
  })

  it('mixed messages (user + assistant) → only assistant messages processed', () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
      msg({ id: 'm1', timeline: [{ kind: 'reasoning', stepSeq: 0, agentId: 'a1', role: 'supervisor', content: 'x' }] }),
      { id: 'u2', role: 'user', content: 'ok', timestamp: 1 },
    ]
    const turns = groupAllAgents(messages, 'idle')
    expect(turns).toHaveLength(1)
    expect(turns[0].messageId).toBe('m1')
  })

  it('assistant message with timeline but no agentRuns (reasoning only) → included in output', () => {
    const messages = [
      msg({ id: 'm1', timeline: [{ kind: 'reasoning', stepSeq: 0, agentId: 'a1', role: 'supervisor', content: 'thinking' }] }),
    ]
    const turns = groupAllAgents(messages, 'idle')
    expect(turns).toHaveLength(1)
    expect(turns[0].messageId).toBe('m1')
  })
})
