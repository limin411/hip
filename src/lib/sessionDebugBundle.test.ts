import { describe, it, expect } from 'vitest'
import {
  buildDebugAnalysis,
  buildSessionDebugBundle,
  clipForExport,
  MAX_CONTENT,
  MAX_TOOL_FIELD,
  redactObject,
  sessionDebugBundleJson,
} from './sessionDebugBundle'

describe('sessionDebugBundle', () => {
  it('redacts sensitive keys deeply', () => {
    const out = redactObject({
      model: 'x',
      apiKey: 'sk-secret',
      nested: { token: 'abc', ok: 1 },
    })
    expect(out.apiKey).toBe('[redacted]')
    expect((out.nested as { token: string }).token).toBe('[redacted]')
    expect((out.nested as { ok: number }).ok).toBe(1)
  })

  it('builds a versioned bundle with clipped content', () => {
    const bundle = buildSessionDebugBundle({
      sessionId: 's1',
      title: 'T',
      config: { llmProvider: 'deepseek', model: 'm', apiKey: 'nope', surface: 'code', cwd: '/p' } as never,
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'hi',
          timestamp: 1,
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'x'.repeat(MAX_CONTENT + 500),
          timestamp: 2,
          stopped: true,
          agentId: 'supervisor',
        },
      ],
      now: () => '2026-07-10T00:00:00.000Z',
    })
    expect(bundle.version).toBe(3)
    expect(bundle.exportedAt).toBe('2026-07-10T00:00:00.000Z')
    expect(bundle.session.config.apiKey).toBeUndefined()
    expect(bundle.session.surface).toBe('code')
    expect(bundle.session.runtime?.subagentMaxConcurrency).toBeGreaterThanOrEqual(1)
    expect(bundle.session.runtime?.toolParallelismDefault).toBe(5)
    expect(bundle.messages[1]!.content).toContain('export clipped')
    expect(bundle.messages[1]!.content).toContain('not a runtime tool cap')
    expect(bundle.messages[1]!.stopped).toBe(true)
    expect(bundle.analysis?.assistantTurns).toBe(1)
    expect(bundle.analysis?.stoppedTurns).toBe(1)
    expect(sessionDebugBundleJson({
      sessionId: 's1',
      title: 'T',
      messages: [],
      now: () => 't',
    })).toContain('"version": 3')
  })

  it('includes ui state and tool-error analysis for plan/HITL postmortems', () => {
    const bundle = buildSessionDebugBundle({
      sessionId: 's1',
      title: 'T',
      config: { llmProvider: 'deepseek', model: 'm', forcePlan: true } as never,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'plan',
          timestamp: 10,
          toolCalls: [
            {
              callId: 'c1',
              agentId: 'supervisor',
              name: 'web_fetch',
              input: '{}',
              output: 'Error: DNS resolution failed',
              status: 'finished',
              seq: 1,
            },
            {
              callId: 'c2',
              agentId: 'supervisor',
              name: 'ExitPlanMode',
              input: '{}',
              output: 'Exited plan mode. Plan ready for review.',
              status: 'finished',
              seq: 2,
            },
          ],
          agentRuns: [
            {
              agentId: 'supervisor',
              role: 'supervisor',
              output: 'plan',
              startedAt: 10,
              finishedAt: 50,
              seq: 0,
            },
          ],
        },
      ],
      ui: {
        status: 'idle',
        planApprovalPending: true,
        interrupt: {
          turnId: 't1',
          question: 'Review the plan',
          context: JSON.stringify({ kind: 'plan_approval' }),
        },
        activeTurnPlan: [{ content: 'step', status: 'pending' }],
        forcePlan: true,
      },
      now: () => 't',
    })
    expect(bundle.session.ui?.planApprovalPending).toBe(true)
    expect(bundle.session.ui?.interrupt?.turnId).toBe('t1')
    expect(bundle.session.ui?.activeTurnPlan?.[0]?.content).toBe('step')
    expect(bundle.analysis?.toolErrorCount).toBe(1)
    expect(bundle.analysis?.planToolCounts.ExitPlanMode).toBe(1)
    expect(bundle.analysis?.toolErrors[0]?.preview).toContain('DNS')
    expect(bundle.messages[0]!.meta?.hasExitPlanMode).toBe(true)
    expect(bundle.messages[0]!.meta?.toolErrorCount).toBe(1)
    expect(bundle.messages[0]!.meta?.durationMs).toBe(40)
  })

  it('buildDebugAnalysis counts tools and gaps', () => {
    const analysis = buildDebugAnalysis([
      { id: 'u', role: 'user', content: 'hi', timestamp: 100 },
      {
        id: 'a',
        role: 'assistant',
        content: 'ok',
        timestamp: 250,
        stopped: true,
        toolCalls: [
          {
            callId: 'c',
            agentId: 'supervisor',
            name: 'write_todos',
            input: '{}',
            output: 'ok',
            status: 'finished',
            seq: 1,
          },
        ],
      },
    ])
    expect(analysis.userTurns).toBe(1)
    expect(analysis.assistantTurns).toBe(1)
    expect(analysis.stoppedTurns).toBe(1)
    expect(analysis.planToolCounts.write_todos).toBe(1)
    expect(analysis.messageGapsMs).toEqual([150])
  })

  it('preserves agentRun taskInput/parentAgentId/seq and timeline', () => {
    const bundle = buildSessionDebugBundle({
      sessionId: 's1',
      title: 'T',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'ok',
          timestamp: 99,
          agentRuns: [
            {
              agentId: 'subagent-1',
              role: 'subagent',
              output: 'report',
              startedAt: 1,
              finishedAt: 2,
              seq: 3,
              taskInput: 'check poms',
              parentAgentId: 'supervisor',
              messageId: 'm1',
            },
          ],
          timeline: [
            { kind: 'tool', stepSeq: 1, agentId: 'subagent-1', role: 'subagent', callId: 'c1' },
          ],
        },
      ],
      now: () => 't',
    })
    const run = (bundle.messages[0]!.agentRuns as Array<Record<string, unknown>>)[0]!
    expect(run.taskInput).toBe('check poms')
    expect(run.parentAgentId).toBe('supervisor')
    expect(run.seq).toBe(3)
    expect(bundle.messages[0]!.timestamp).toBe(99)
    expect(bundle.messages[0]!.timeline).toHaveLength(1)
  })

  it('marks tool fields with exportClipped and preserves runtime truncated', () => {
    const longOut = 'y'.repeat(MAX_TOOL_FIELD + 100)
    const bundle = buildSessionDebugBundle({
      sessionId: 's1',
      title: 'T',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'ok',
          timestamp: 1,
          toolCalls: [
            {
              callId: 'c1',
              agentId: 'supervisor',
              name: 'read_file',
              input: '{}',
              output: longOut,
              status: 'finished',
              seq: 1,
              truncated: true,
            },
          ],
        },
      ],
      now: () => 't',
    })
    const tc = bundle.messages[0]!.toolCalls![0] as Record<string, unknown>
    expect(tc.truncated).toBe(true)
    expect(tc.exportClipped).toBe(true)
    expect(String(tc.output)).toContain('export clipped')
    expect(String(tc.output)).toContain('not a runtime tool cap')
    expect(String(tc.output).length).toBeLessThan(longOut.length)
  })

  it('does not set exportClipped when tool fields fit under the cap', () => {
    const bundle = buildSessionDebugBundle({
      sessionId: 's1',
      title: 'T',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'ok',
          timestamp: 1,
          toolCalls: [
            {
              callId: 'c1',
              agentId: 'supervisor',
              name: 'ls',
              input: '{"path":"."}',
              output: 'a.txt',
              status: 'finished',
              seq: 1,
            },
          ],
        },
      ],
      now: () => 't',
    })
    const tc = bundle.messages[0]!.toolCalls![0] as Record<string, unknown>
    expect(tc.exportClipped).toBeUndefined()
    expect(tc.output).toBe('a.txt')
  })
})

describe('clipForExport', () => {
  it('passes through short strings', () => {
    expect(clipForExport('hi', 10)).toEqual({ text: 'hi', exportClipped: false })
  })

  it('labels export clips distinctly from runtime caps', () => {
    const r = clipForExport('abcdefghij', 4)
    expect(r.exportClipped).toBe(true)
    expect(r.text).toMatch(/^abcd/)
    expect(r.text).toContain('export clipped 6 chars')
    expect(r.text).toContain('not a runtime tool cap')
  })
})
