import { describe, it, expect } from 'vitest'
import type { Message, ToolCall } from '@hip/protocol'
import { latestTodos, parseTodos, planProgress, selectLivePlan, type Todo } from './todos'

function tc(over: Partial<ToolCall>): ToolCall {
  return { callId: 'c', agentId: 'supervisor', name: 'write_todos', input: '{}', status: 'finished', seq: 0, ...over }
}

function assistant(over: Partial<Message> = {}): Message {
  return {
    id: 'a1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    ...over,
  }
}

function user(over: Partial<Message> = {}): Message {
  return {
    id: 'u1',
    role: 'user',
    content: 'hi',
    timestamp: 1,
    ...over,
  }
}

describe('parseTodos', () => {
  it('parses a valid write_todos input into typed todos', () => {
    const todos = parseTodos(
      JSON.stringify({ todos: [
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
        { content: 'c', status: 'pending' },
      ] }),
    )
    expect(todos).toEqual<Todo[]>([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ])
  })

  it('returns [] for malformed JSON', () => {
    expect(parseTodos('not json')).toEqual([])
  })

  it('drops entries with a bad shape or unknown status', () => {
    const todos = parseTodos(
      JSON.stringify({ todos: [{ content: 'ok', status: 'pending' }, { content: 'x', status: 'blocked' }, { nope: 1 }] }),
    )
    expect(todos).toEqual<Todo[]>([{ content: 'ok', status: 'pending' }])
  })
})

describe('latestTodos', () => {
  it('returns the highest-seq write_todos call as the live plan', () => {
    const calls: ToolCall[] = [
      tc({ callId: 'c1', seq: 1, input: JSON.stringify({ todos: [{ content: 'old', status: 'pending' }] }) }),
      tc({ callId: 'r1', seq: 2, name: 'read_file', input: '{"path":"/x"}' }),
      tc({ callId: 'c2', seq: 3, input: JSON.stringify({ todos: [{ content: 'new', status: 'in_progress' }] }) }),
    ]
    const live = latestTodos(calls)
    expect(live).not.toBeNull()
    expect(live!.callId).toBe('c2')
    expect(live!.todos).toEqual<Todo[]>([{ content: 'new', status: 'in_progress' }])
  })

  it('ignores a sub-agent (non-supervisor) write_todos call so it cannot mask the main plan', () => {
    const calls: ToolCall[] = [
      tc({ callId: 's1', seq: 1, input: JSON.stringify({ todos: [{ content: 'supervisor plan', status: 'in_progress' }] }) }),
      tc({ callId: 'w1', seq: 9, agentId: 'worker-1', input: JSON.stringify({ todos: [{ content: 'child plan', status: 'pending' }] }) }),
    ]
    const live = latestTodos(calls)
    expect(live!.callId).toBe('s1')
    expect(live!.todos).toEqual<Todo[]>([{ content: 'supervisor plan', status: 'in_progress' }])
  })

  it('returns null when there is no write_todos call', () => {
    expect(latestTodos([tc({ name: 'read_file', input: '{}' })])).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(latestTodos(undefined)).toBeNull()
  })
})

describe('planProgress', () => {
  it('counts completed and surfaces the first in_progress item', () => {
    expect(
      planProgress([
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
        { content: 'c', status: 'pending' },
      ]),
    ).toEqual({ done: 1, total: 3, current: 'b' })
  })
})

describe('selectLivePlan', () => {
  const todosInput = JSON.stringify({
    todos: [
      { content: 'step a', status: 'completed' },
      { content: 'step b', status: 'in_progress' },
    ],
  })

  it('returns awaiting_approval from activeTurnPlan when pending', () => {
    const view = selectLivePlan({
      messages: [],
      status: 'idle',
      planApprovalPending: true,
      activeTurnPlan: [{ content: 'approve me', status: 'pending' }],
    })
    expect(view?.phase).toBe('awaiting_approval')
    expect(view?.items).toEqual([{ content: 'approve me', status: 'pending' }])
    expect(view?.source).toBe('activeTurnPlan')
  })

  it('returns planning empty shell when forcePlan and running without todos', () => {
    const view = selectLivePlan({
      messages: [user()],
      status: 'running',
      forcePlan: true,
    })
    expect(view).toEqual({
      items: [],
      phase: 'planning',
      source: 'empty',
      progress: { done: 0, total: 0 },
    })
  })

  it('uses write_todos on the last assistant while running', () => {
    const view = selectLivePlan({
      messages: [
        user(),
        assistant({
          toolCalls: [tc({ input: todosInput, seq: 1 })],
        }),
      ],
      status: 'running',
    })
    expect(view?.phase).toBe('executing')
    expect(view?.source).toBe('write_todos')
    expect(view?.progress).toEqual({ done: 1, total: 2, current: 'step b' })
  })

  it('marks done after idle when last assistant has write_todos', () => {
    const view = selectLivePlan({
      messages: [
        user(),
        assistant({
          toolCalls: [tc({ input: todosInput, seq: 1 })],
        }),
      ],
      status: 'idle',
    })
    expect(view?.phase).toBe('done')
    expect(view?.items).toHaveLength(2)
  })

  it('does not stick previous todos when a new user turn is running without forcePlan', () => {
    const view = selectLivePlan({
      messages: [
        user({ id: 'u0' }),
        assistant({
          toolCalls: [tc({ input: todosInput, seq: 1 })],
        }),
        user({ id: 'u1', content: 'next' }),
      ],
      status: 'running',
      forcePlan: false,
    })
    expect(view).toBeNull()
  })

  it('prefers activeTurnPlan during new-turn execute resume', () => {
    const view = selectLivePlan({
      messages: [user({ content: 'go' })],
      status: 'running',
      activeTurnPlan: [{ content: 'resume step', status: 'in_progress' }],
    })
    expect(view?.phase).toBe('executing')
    expect(view?.source).toBe('activeTurnPlan')
    expect(view?.items[0]?.content).toBe('resume step')
  })

  it('returns null for ordinary idle chat', () => {
    expect(
      selectLivePlan({
        messages: [user(), assistant({ content: 'ok' })],
        status: 'idle',
      }),
    ).toBeNull()
  })
})
