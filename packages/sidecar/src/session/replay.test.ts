import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../persistence/open.js'
import { EventStore } from '../persistence/event-store.js'
import { SessionReplay } from './replay.js'

function freshStore(): EventStore {
  const { db } = openDatabase(':memory:')
  return new EventStore(db)
}

describe('SessionReplay', () => {
  let store: EventStore
  let replay: SessionReplay

  beforeEach(() => {
    store = freshStore()
    replay = new SessionReplay(store)
  })

  describe('replayTurn', () => {
    it('reconstructs both turns correctly for a 2-turn session', async () => {
      // Turn 0: user asks "hello", agent responds "hi there"
      store.publish('s1', 'user_message', { messageId: 'u-1', content: 'hello', timestamp: 1000 })
      store.publish('s1', 'text_started', { stepId: 't1' })
      store.publish('s1', 'text_ended', { stepId: 't1', content: 'hi there' })
      store.publish('s1', 'step_ended', { stepId: 't1', agentId: 'supervisor', finishedAt: 2000 })

      // Turn 1: user asks "how are you", agent responds "good thanks"
      store.publish('s1', 'user_message', { messageId: 'u-2', content: 'how are you', timestamp: 3000 })
      store.publish('s1', 'text_started', { stepId: 't2' })
      store.publish('s1', 'text_ended', { stepId: 't2', content: 'good thanks' })
      store.publish('s1', 'step_ended', { stepId: 't2', agentId: 'supervisor', finishedAt: 4000 })

      // Replay turn 0: messages at start should be empty (no prior turns)
      const r0 = await replay.replayTurn('s1', 0)
      expect(r0.messages).toEqual([])
      expect(r0.agentResponse).toBe('hi there')
      expect(r0.toolCalls).toEqual([])

      // Replay turn 1: messages should include turn 0
      const r1 = await replay.replayTurn('s1', 1)
      expect(r1.messages).toEqual([
        { type: 'human', content: 'hello' },
        { type: 'ai', content: 'hi there' },
      ])
      expect(r1.agentResponse).toBe('good thanks')
      expect(r1.toolCalls).toEqual([])
    })

    it('replays a turn with tool calls and exposes inputs and outputs', async () => {
      store.publish('s1', 'user_message', { messageId: 'u-1', content: 'read file x', timestamp: 1000 })
      store.publish('s1', 'text_started', { stepId: 't1' })
      store.publish('s1', 'tool_called', {
        callId: 'c1',
        stepId: 't1',
        name: 'read_file',
        input: '{"path":"/tmp/x.txt"}',
        seq: 1,
      })
      store.publish('s1', 'tool_success', {
        callId: 'c1',
        stepId: 't1',
        output: 'file contents here',
      })
      store.publish('s1', 'tool_called', {
        callId: 'c2',
        stepId: 't1',
        name: 'edit_file',
        input: '{"path":"/tmp/y.txt","old":"a","new":"b"}',
        seq: 2,
      })
      store.publish('s1', 'tool_failed', {
        callId: 'c2',
        stepId: 't1',
        error: 'permission denied',
      })
      store.publish('s1', 'text_ended', { stepId: 't1', content: 'done reading' })
      store.publish('s1', 'step_ended', { stepId: 't1', agentId: 'supervisor', finishedAt: 2000 })

      const r = await replay.replayTurn('s1', 0)
      expect(r.agentResponse).toBe('done reading')
      expect(r.toolCalls).toHaveLength(2)
      expect(r.toolCalls[0]).toMatchObject({
        name: 'read_file',
        input: { path: '/tmp/x.txt' },
        output: 'file contents here',
      })
      expect(r.toolCalls[1]).toMatchObject({
        name: 'edit_file',
        input: { path: '/tmp/y.txt', old: 'a', new: 'b' },
        error: 'permission denied',
      })
      // r.toolCalls[1] should NOT have output
      expect(r.toolCalls[1]).not.toHaveProperty('output')
    })

    it('returns error for a non-existent session', async () => {
      await expect(replay.replayTurn('nonexistent', 0)).rejects.toThrow(
        'No events found for session nonexistent',
      )
    })

    it('returns empty result for a session with no turns', async () => {
      // A session with some events but no user_message (e.g. only step_started without completion)
      store.publish('s1', 'step_started', { stepId: 't1', agentId: 'supervisor', startedAt: 1000 })
      store.publish('s1', 'step_ended', { stepId: 't1', agentId: 'supervisor', finishedAt: 2000 })

      const r = await replay.replayTurn('s1', 0)
      expect(r.messages).toEqual([])
      expect(r.agentResponse).toBeUndefined()
      expect(r.toolCalls).toEqual([])
    })

    it('replays only the requested tool calls belonging to the correct turn', async () => {
      // Turn 0: tool c1
      store.publish('s1', 'user_message', { messageId: 'u-1', content: 'task 1', timestamp: 1000 })
      store.publish('s1', 'text_started', { stepId: 't1' })
      store.publish('s1', 'tool_called', { callId: 'c1', stepId: 't1', name: 'tool_a', input: '{"x":1}', seq: 1 })
      store.publish('s1', 'tool_success', { callId: 'c1', stepId: 't1', output: 'result-a' })
      store.publish('s1', 'text_ended', { stepId: 't1', content: 'done 1' })
      store.publish('s1', 'step_ended', { stepId: 't1', agentId: 'supervisor', finishedAt: 2000 })

      // Turn 1: tool c2
      store.publish('s1', 'user_message', { messageId: 'u-2', content: 'task 2', timestamp: 3000 })
      store.publish('s1', 'text_started', { stepId: 't2' })
      store.publish('s1', 'tool_called', { callId: 'c2', stepId: 't2', name: 'tool_b', input: '{"y":2}', seq: 1 })
      store.publish('s1', 'tool_success', { callId: 'c2', stepId: 't2', output: 'result-b' })
      store.publish('s1', 'text_ended', { stepId: 't2', content: 'done 2' })
      store.publish('s1', 'step_ended', { stepId: 't2', agentId: 'supervisor', finishedAt: 4000 })

      const r0 = await replay.replayTurn('s1', 0)
      expect(r0.toolCalls).toHaveLength(1)
      expect(r0.toolCalls[0].name).toBe('tool_a')

      const r1 = await replay.replayTurn('s1', 1)
      expect(r1.toolCalls).toHaveLength(1)
      expect(r1.toolCalls[0].name).toBe('tool_b')
    })

    it('preserves raw string input when JSON parsing fails', async () => {
      store.publish('s1', 'user_message', { messageId: 'u-1', content: 'do it', timestamp: 1000 })
      store.publish('s1', 'text_started', { stepId: 't1' })
      store.publish('s1', 'tool_called', { callId: 'c1', stepId: 't1', name: 't', input: 'not-json', seq: 1 })
      store.publish('s1', 'tool_success', { callId: 'c1', stepId: 't1', output: 'ok' })
      store.publish('s1', 'text_ended', { stepId: 't1', content: 'done' })
      store.publish('s1', 'step_ended', { stepId: 't1', agentId: 'supervisor', finishedAt: 2000 })

      const r = await replay.replayTurn('s1', 0)
      expect(r.toolCalls[0].input).toBe('not-json')
    })
  })
})
