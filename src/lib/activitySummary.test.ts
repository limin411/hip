import { describe, it, expect } from 'vitest'
import type { ToolCall, AgentRun } from '@hip/protocol'
import {
  buildActivitySummary,
  resolveActivityStatus,
  countToolsByCategory,
  extractTaskHint,
  formatElapsed,
  activityElapsedMs,
} from './activitySummary'

const tc = (over: Partial<ToolCall> & Pick<ToolCall, 'callId' | 'name'>): ToolCall => ({
  agentId: 'supervisor',
  input: '{}',
  status: 'finished',
  seq: 1,
  ...over,
})

describe('activitySummary', () => {
  it('resolveActivityStatus: tool errors + content → success_partial', () => {
    expect(
      resolveActivityStatus({
        hasAssistantContent: true,
        toolCalls: [tc({ callId: '1', name: 'grep', status: 'error' })],
      }),
    ).toBe('success_partial')
  })

  it('resolveActivityStatus: tool errors without content → error', () => {
    expect(
      resolveActivityStatus({
        hasAssistantContent: false,
        toolCalls: [tc({ callId: '1', name: 'grep', status: 'error' })],
      }),
    ).toBe('error')
  })

  it('resolveActivityStatus: streaming → running', () => {
    expect(resolveActivityStatus({ streaming: true, toolCalls: [] })).toBe('running')
  })

  it('resolveActivityStatus: stopped', () => {
    expect(resolveActivityStatus({ stopped: true, hasAssistantContent: true })).toBe('stopped')
  })

  it('completed summary includes category or task, not only toolCount when available', () => {
    const tools = [
      tc({ callId: '1', name: 'grep', input: '{"pattern":"zuolin"}', seq: 1 }),
      tc({ callId: '2', name: 'read_file', input: '{"path":"a.java"}', seq: 2 }),
      tc({ callId: '3', name: 'task', input: '{"description":"Find Zuolin sync"}', seq: 0 }),
    ]
    const { parts, status } = buildActivitySummary({
      toolCalls: tools,
      hasAssistantContent: true,
    })
    expect(status).toBe('success')
    expect(parts.some((p) => p.type === 'taskHint')).toBe(true)
    expect(parts.some((p) => p.type === 'categorySummary')).toBe(true)
    expect(parts.some((p) => p.type === 'toolCount')).toBe(true)
  })

  it('partial tools part when errors and content', () => {
    const { status, parts } = buildActivitySummary({
      hasAssistantContent: true,
      toolCalls: [
        tc({ callId: '1', name: 'grep', status: 'error' }),
        tc({ callId: '2', name: 'read_file', status: 'finished', seq: 2 }),
      ],
    })
    expect(status).toBe('success_partial')
    expect(parts).toContainEqual({ type: 'partialTools', count: 1 })
  })

  it('streaming last text step does not show runningReasoning when content is present', () => {
    const steps = [
      { kind: 'text' as const, stepSeq: 0, agentId: 'supervisor', role: 'supervisor' as const, content: 'Hello' },
    ]
    const { parts, status } = buildActivitySummary({
      streaming: true,
      hasAssistantContent: true,
      steps,
      toolCalls: [],
    })
    expect(status).toBe('running')
    expect(parts.some((p) => p.type === 'runningReasoning')).toBe(false)
  })

  it('streaming tool uses title hint label', () => {
    const tools = [tc({ callId: 'c1', name: 'grep', input: '{"pattern":"zuolin"}', status: 'running' })]
    const steps = [
      { kind: 'tool' as const, stepSeq: 1, agentId: 'supervisor', role: 'supervisor' as const, callId: 'c1' },
    ]
    const { parts } = buildActivitySummary({ streaming: true, toolCalls: tools, steps })
    expect(parts[0]).toMatchObject({ type: 'runningTool' })
    if (parts[0].type === 'runningTool') {
      expect(parts[0].label).toContain('zuolin')
    }
  })

  it('includes planProgress from supervisor write_todos', () => {
    const tools = [
      tc({
        callId: 'p1',
        name: 'write_todos',
        input: JSON.stringify({
          todos: [
            { content: 'a', status: 'completed' },
            { content: 'b', status: 'pending' },
          ],
        }),
        seq: 0,
      }),
      tc({ callId: '2', name: 'grep', input: '{"pattern":"x"}', seq: 1 }),
    ]
    const { parts } = buildActivitySummary({ toolCalls: tools, hasAssistantContent: true })
    expect(parts).toContainEqual({ type: 'planProgress', done: 1, total: 2 })
  })

  it('prefixes planProgress while streaming', () => {
    const tools = [
      tc({
        callId: 'p1',
        name: 'write_todos',
        input: JSON.stringify({ todos: [{ content: 'a', status: 'in_progress' }] }),
        seq: 0,
      }),
      tc({ callId: 'c1', name: 'grep', input: '{"pattern":"zuolin"}', status: 'running', seq: 1 }),
    ]
    const steps = [
      { kind: 'tool' as const, stepSeq: 1, agentId: 'supervisor', role: 'supervisor' as const, callId: 'c1' },
    ]
    const { parts } = buildActivitySummary({ streaming: true, toolCalls: tools, steps })
    expect(parts[0]).toEqual({ type: 'planProgress', done: 0, total: 1 })
    expect(parts[1]).toMatchObject({ type: 'runningTool' })
  })

  it('countToolsByCategory', () => {
    const c = countToolsByCategory([
      tc({ callId: '1', name: 'grep' }),
      tc({ callId: '2', name: 'glob', seq: 2 }),
      tc({ callId: '3', name: 'ls', seq: 3 }),
    ])
    expect(c.search).toBe(1)
    expect(c.browse).toBe(2)
  })

  it('extractTaskHint from task tool', () => {
    expect(
      extractTaskHint([tc({ callId: '1', name: 'task', input: '{"description":"Find sync"}' })], []),
    ).toContain('Find sync')
  })

  it('activityElapsedMs and formatElapsed', () => {
    const runs: AgentRun[] = [
      {
        agentId: 'supervisor',
        role: 'supervisor',
        output: '',
        startedAt: 1000,
        finishedAt: 4000,
        seq: 1,
      },
    ]
    expect(activityElapsedMs(runs)).toBe(3000)
    expect(formatElapsed(3000)).toBe('3s')
    expect(formatElapsed(125000)).toBe('2m 5s')
  })
})
