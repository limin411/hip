import { describe, it, expect } from 'vitest'
import type { ToolCall } from '@hip/protocol'
import { latestTodos, parseTodos, type Todo } from './todos'

function tc(over: Partial<ToolCall>): ToolCall {
  return { callId: 'c', agentId: 'supervisor', name: 'write_todos', input: '{}', status: 'finished', seq: 0, ...over }
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

  it('returns null when there is no write_todos call', () => {
    expect(latestTodos([tc({ name: 'read_file', input: '{}' })])).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(latestTodos(undefined)).toBeNull()
  })
})
