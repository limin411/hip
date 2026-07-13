import { describe, it, expect } from 'vitest'
import type { ToolCall } from '@hip/protocol'
import { groupToolCalls, TOOL_GROUP_THRESHOLD } from './toolGroups'

const tc = (i: number, name: string): ToolCall => ({
  callId: `c${i}`,
  agentId: 'supervisor',
  name,
  input: '{}',
  status: 'finished',
  seq: i,
})

describe('groupToolCalls', () => {
  it('returns flat when below threshold', () => {
    const tools = Array.from({ length: TOOL_GROUP_THRESHOLD - 1 }, (_, i) => tc(i, 'grep'))
    const r = groupToolCalls(tools)
    expect(r.mode).toBe('flat')
    if (r.mode === 'flat') expect(r.tools).toHaveLength(TOOL_GROUP_THRESHOLD - 1)
  })

  it('returns grouped when at or above threshold', () => {
    const tools = [
      ...Array.from({ length: 5 }, (_, i) => tc(i, 'grep')),
      ...Array.from({ length: 5 }, (_, i) => tc(i + 10, 'read_file')),
    ]
    const r = groupToolCalls(tools)
    expect(r.mode).toBe('grouped')
    if (r.mode === 'grouped') {
      expect(r.groups.some((g) => g.category === 'search')).toBe(true)
      expect(r.groups.some((g) => g.category === 'read')).toBe(true)
    }
  })

  it('excludes write_todos from groups', () => {
    const tools = [
      ...Array.from({ length: 8 }, (_, i) => tc(i, 'grep')),
      tc(99, 'write_todos'),
    ]
    const r = groupToolCalls(tools)
    expect(r.mode).toBe('grouped')
    if (r.mode === 'grouped') {
      const all = r.groups.flatMap((g) => g.tools)
      expect(all.every((t) => t.name !== 'write_todos')).toBe(true)
    }
  })
})
