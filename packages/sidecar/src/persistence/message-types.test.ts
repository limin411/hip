import { describe, it, expect } from 'vitest'
import {
  stepRowId,
  compactionRowId,
  isAssistantStep,
  SESSION_EVENT_TYPES,
  type SessionMessageData,
} from './message-types.js'

describe('message-types: row id helpers', () => {
  it('stepRowId is deterministic', () => {
    expect(stepRowId('s1', 'step-a')).toBe('s1:step:step-a')
    expect(stepRowId('s1', 'step-a')).toBe('s1:step:step-a')
  })

  it('compactionRowId is deterministic', () => {
    expect(compactionRowId('s1', 42)).toBe('s1:compaction:42')
  })
})

describe('message-types: SESSION_EVENT_TYPES', () => {
  it('contains the expected handled event types', () => {
    expect(SESSION_EVENT_TYPES).toEqual([
      'user_message',
      'step_started',
      'step_ended',
      'step_failed',
      'text_started',
      'text_ended',
      'tool_called',
      'tool_success',
      'tool_failed',
      'compaction_ended',
      'agent_switched',
      'model_switched',
    ])
  })
})

describe('message-types: isAssistantStep', () => {
  it('returns true for a normal assistant step data', () => {
    const data: SessionMessageData = {
      role: 'assistant',
      stepId: 'step-1',
      agentId: 'a1',
      agentRole: 'supervisor',
      content: '',
      toolCalls: [],
      startedAt: 1,
      finishedAt: null,
      error: null,
      usage: null,
    }
    expect(isAssistantStep(data)).toBe(true)
  })

  it('returns false for a user row', () => {
    const data: SessionMessageData = { role: 'user', content: 'hi', messageId: 'm1' }
    expect(isAssistantStep(data)).toBe(false)
  })

  it('returns false for a compaction summary row', () => {
    const data: SessionMessageData = {
      role: 'assistant',
      kind: 'compaction',
      summary: 'summary',
      replacedMessageIds: [],
    }
    expect(isAssistantStep(data)).toBe(false)
  })
})
