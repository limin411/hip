import { describe, it, expect } from 'vitest'
import type { Message } from '@hip/protocol'
import {
  buildPhase1Transcript,
  shouldIncludeAssistantInPhase1,
  transcriptMeetsMinContent,
  countUserContent,
} from './transcript.js'

function msg(partial: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return {
    timestamp: 1,
    ...partial,
  }
}

describe('shouldIncludeAssistantInPhase1', () => {
  it('includes supervisor and null/undefined agentId', () => {
    expect(shouldIncludeAssistantInPhase1(msg({ id: 'a', role: 'assistant', content: 'x', agentId: 'supervisor' }))).toBe(true)
    expect(shouldIncludeAssistantInPhase1(msg({ id: 'a', role: 'assistant', content: 'x' }))).toBe(true)
  })

  it('excludes child agent assistant messages', () => {
    expect(
      shouldIncludeAssistantInPhase1(
        msg({
          id: 'a',
          role: 'assistant',
          content: 'child only output SECRET_CHILD',
          agentId: 'worker-1',
          agentRuns: [
            {
              agentId: 'worker-1',
              role: 'worker',
              output: 'child only',
              startedAt: 1,
              finishedAt: 2,
              seq: 0,
              parentAgentId: 'supervisor',
            },
          ],
        }),
      ),
    ).toBe(false)
  })

  it('includes non-supervisor when all runs have null parent', () => {
    expect(
      shouldIncludeAssistantInPhase1(
        msg({
          id: 'a',
          role: 'assistant',
          content: 'solo',
          agentId: 'solo-agent',
          agentRuns: [
            {
              agentId: 'solo-agent',
              role: 'worker',
              output: 'solo',
              startedAt: 1,
              finishedAt: 2,
              seq: 0,
            },
          ],
        }),
      ),
    ).toBe(true)
  })
})

describe('buildPhase1Transcript', () => {
  it('includes user + supervisor; excludes child assistant content', () => {
    const messages: Message[] = [
      msg({ id: 'u1', role: 'user', content: 'please fix the bug' }),
      msg({
        id: 'a1',
        role: 'assistant',
        content: 'supervisor reply',
        agentId: 'supervisor',
      }),
      msg({
        id: 'a2',
        role: 'assistant',
        content: 'CHILD_AGENT_SECRET_BLOB',
        agentId: 'worker-1',
        agentRuns: [
          {
            agentId: 'worker-1',
            role: 'worker',
            output: 'CHILD_AGENT_SECRET_BLOB',
            startedAt: 1,
            finishedAt: 2,
            seq: 0,
            parentAgentId: 'supervisor',
          },
        ],
      }),
    ]
    const t = buildPhase1Transcript(messages)
    expect(t).toContain('please fix the bug')
    expect(t).toContain('supervisor reply')
    expect(t).not.toContain('CHILD_AGENT_SECRET_BLOB')
  })

  it('does not dump tool outputs as paragraphs', () => {
    const messages: Message[] = [
      msg({ id: 'u1', role: 'user', content: 'read file' }),
      msg({
        id: 'a1',
        role: 'assistant',
        content: 'done',
        agentId: 'supervisor',
        toolCalls: [
          {
            callId: 'c1',
            agentId: 'supervisor',
            name: 'read_file',
            input: '{}',
            output: 'HUGE_TOOL_OUTPUT_SHOULD_NOT_APPEAR',
            status: 'finished',
            seq: 0,
          },
        ],
      }),
    ]
    const t = buildPhase1Transcript(messages)
    expect(t).toContain('done')
    expect(t).not.toContain('HUGE_TOOL_OUTPUT_SHOULD_NOT_APPEAR')
  })

  it('drops oldest lines when over maxChars', () => {
    const messages: Message[] = [
      msg({ id: 'u1', role: 'user', content: 'AAAA_OLD' }),
      msg({ id: 'a1', role: 'assistant', content: 'old reply', agentId: 'supervisor' }),
      msg({ id: 'u2', role: 'user', content: 'BBBB_NEW' }),
    ]
    const t = buildPhase1Transcript(messages, 30)
    expect(t).toContain('BBBB_NEW')
    expect(t).not.toContain('AAAA_OLD')
  })
})

describe('transcriptMeetsMinContent', () => {
  it('passes when min turns met', () => {
    const messages = [
      msg({ id: 'u1', role: 'user', content: 'hi' }),
      msg({ id: 'u2', role: 'user', content: 'yo' }),
    ]
    expect(transcriptMeetsMinContent(messages, 2, 80)).toBe(true)
  })

  it('passes when min chars met with one turn', () => {
    const messages = [msg({ id: 'u1', role: 'user', content: 'x'.repeat(80) })]
    expect(transcriptMeetsMinContent(messages, 2, 80)).toBe(true)
  })

  it('fails when neither met', () => {
    const messages = [msg({ id: 'u1', role: 'user', content: 'short' })]
    expect(transcriptMeetsMinContent(messages, 2, 80)).toBe(false)
  })

  it('string form uses char threshold only', () => {
    expect(transcriptMeetsMinContent('x'.repeat(80), 2, 80)).toBe(true)
    expect(transcriptMeetsMinContent('short', 2, 80)).toBe(false)
  })
})

describe('countUserContent', () => {
  it('counts turns and chars', () => {
    expect(
      countUserContent([
        msg({ id: 'u1', role: 'user', content: 'ab' }),
        msg({ id: 'a1', role: 'assistant', content: 'ignored' }),
        msg({ id: 'u2', role: 'user', content: 'cd' }),
      ]),
    ).toEqual({ turns: 2, chars: 4 })
  })
})
