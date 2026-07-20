import { describe, it, expect } from 'vitest'
import type { TimelineStep, ToolCall } from '@hip/protocol'
import {
  isSuppressedToolStep,
  isSupervisorTextStep,
  prepareTimelineTextContent,
  hasRenderableSupervisorText,
} from './timelineFilter'

const tc = (over: Partial<ToolCall>): ToolCall => ({ callId: 'c1', agentId: 'supervisor', name: 'read_file', input: '{}', status: 'finished', seq: 1, ...over })

describe('isSuppressedToolStep', () => {
  const byCallId = new Map<string, ToolCall>([
    ['c-task', tc({ callId: 'c-task', name: 'task' })],
    ['c-read', tc({ callId: 'c-read', name: 'read_file' })],
  ])

  it('suppresses a tool step whose resolved call is a task delegation', () => {
    const step: TimelineStep = { kind: 'tool', stepSeq: 2, agentId: 'supervisor', role: 'supervisor', callId: 'c-task' }
    expect(isSuppressedToolStep(step, byCallId)).toBe(true)
  })

  it('keeps a normal file tool step', () => {
    const step: TimelineStep = { kind: 'tool', stepSeq: 3, agentId: 'supervisor', role: 'supervisor', callId: 'c-read' }
    expect(isSuppressedToolStep(step, byCallId)).toBe(false)
  })

  it('keeps reasoning steps (never suppressed)', () => {
    const step: TimelineStep = { kind: 'reasoning', stepSeq: 1, agentId: 'supervisor', role: 'supervisor', content: 'thinking' }
    expect(isSuppressedToolStep(step, byCallId)).toBe(false)
  })

  it('does not suppress text steps', () => {
    const step: TimelineStep = { kind: 'text', stepSeq: 5, agentId: 'supervisor', role: 'supervisor', content: 'hello' }
    expect(isSuppressedToolStep(step, byCallId)).toBe(false)
  })

  it('keeps a tool step whose call is missing from the map', () => {
    const step: TimelineStep = { kind: 'tool', stepSeq: 4, agentId: 'supervisor', role: 'supervisor', callId: 'absent' }
    expect(isSuppressedToolStep(step, byCallId)).toBe(false)
  })
})

describe('isSupervisorTextStep / hasRenderableSupervisorText', () => {
  it('accepts supervisor agentId or role', () => {
    expect(
      isSupervisorTextStep({
        kind: 'text',
        stepSeq: 0,
        agentId: 'supervisor',
        role: 'supervisor',
        content: 'a',
      }),
    ).toBe(true)
    // managed surface: role supervisor, agentId may differ
    expect(
      isSupervisorTextStep({
        kind: 'text',
        stepSeq: 0,
        agentId: 'managed-1',
        role: 'supervisor',
        content: 'a',
      }),
    ).toBe(true)
  })

  it('rejects non-supervisor text (O1 defense)', () => {
    expect(
      isSupervisorTextStep({
        kind: 'text',
        stepSeq: 0,
        agentId: 'worker-1',
        role: 'worker',
        content: 'leak',
      }),
    ).toBe(false)
  })

  it('hasRenderableSupervisorText ignores empty/whitespace and non-supervisor', () => {
    expect(
      hasRenderableSupervisorText([
        { kind: 'text', stepSeq: 0, agentId: 'worker-1', role: 'worker', content: 'leak' },
        { kind: 'text', stepSeq: 1, agentId: 'supervisor', role: 'supervisor', content: '   \n  ' },
      ]),
    ).toBe(false)
    expect(
      hasRenderableSupervisorText([
        { kind: 'text', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'hello' },
      ]),
    ).toBe(true)
  })

  it('prepareTimelineTextContent collapses broken CJK emission (O2)', () => {
    expect(prepareTimelineTextContent('让\n我\n先')).toBe('让我先')
  })
})
