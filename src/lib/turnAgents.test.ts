import { describe, it, expect } from 'vitest'
import type { Message } from '@hip/protocol'
import { groupByAgent } from './turnAgents'

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
      agentRuns: [{ agentId: 'subagent-1', role: 'subagent', output: 'done', startedAt: 0, finishedAt: 1, seq: 0, taskInput: 'do it', parentAgentId: 'supervisor', messageId: 't1' }],
      toolCalls: [],
    })
    const sub = groupByAgent(m, false).find((a) => a.agentId === 'subagent-1')
    expect(sub?.parentAgentId).toBe('supervisor')
    expect(sub?.role).toBe('subagent')
  })
})
