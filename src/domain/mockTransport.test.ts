// src/domain/mockTransport.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ServerMessage } from '@hip/protocol'
import { MockTransport } from './mockTransport'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function collect(): { events: ServerMessage[]; transport: MockTransport } {
  const events: ServerMessage[] = []
  const transport = new MockTransport()
  transport.onMessage((m) => events.push(m))
  return { events, transport }
}

describe('MockTransport', () => {
  it('emits supervisor start immediately on message:send', () => {
    const { events, transport } = collect()
    transport.send({ type: 'message:send', sessionId: 's1', content: 'hi', role: 'user' })
    expect(events[0]).toEqual({ type: 'agent:started', sessionId: 's1', agentId: 'a0', role: 'supervisor' })
  })

  it('starts all four agents and finishes them, ending with message:complete', () => {
    const { events, transport } = collect()
    transport.send({ type: 'message:send', sessionId: 's1', content: 'hi', role: 'user' })
    vi.advanceTimersByTime(10_000)

    const started = events.filter((e) => e.type === 'agent:started').map((e) => (e as any).role)
    expect(new Set(started)).toEqual(new Set(['supervisor', 'planner', 'coder', 'reviewer']))

    const finished = events.filter((e) => e.type === 'agent:finished').map((e) => (e as any).agentId)
    expect(new Set(finished)).toEqual(new Set(['a0', 'a1', 'a2', 'a3']))

    const last = events[events.length - 1]
    expect(last.type).toBe('message:complete')
    expect((last as any).message.role).toBe('assistant')
    expect((last as any).message.content.length).toBeGreaterThan(0)
  })

  it('streams the assistant reply as supervisor (a0) tokens', () => {
    const { events, transport } = collect()
    transport.send({ type: 'message:send', sessionId: 's1', content: 'hi', role: 'user' })
    vi.advanceTimersByTime(10_000)
    const a0Tokens = events.filter((e) => e.type === 'token:stream' && (e as any).agentId === 'a0')
    expect(a0Tokens.length).toBeGreaterThan(5)
  })

  it('disconnect cancels pending timers (no late emissions)', () => {
    const { events, transport } = collect()
    transport.send({ type: 'message:send', sessionId: 's1', content: 'hi', role: 'user' })
    const countAfterStart = events.length
    transport.disconnect()
    vi.advanceTimersByTime(10_000)
    expect(events.length).toBe(countAfterStart)
  })

  it('ignores non-message:send client messages', () => {
    const { events, transport } = collect()
    transport.send({ type: 'session:destroy', sessionId: 's1' })
    vi.advanceTimersByTime(10_000)
    expect(events).toHaveLength(0)
  })
})
