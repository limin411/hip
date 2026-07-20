import { describe, it, expect } from 'vitest'
import type { ServerMessage } from '@hip/protocol'
import {
  emitPlanApprovalResync,
  mergePlanApprovalPauseMarker,
  readPlanApprovalPause,
  stripPlanApprovalPause,
  withPlanApprovalPause,
  withoutPlanApprovalPause,
  PLAN_APPROVAL_PAUSE_KEY,
} from './plan-approval-resync.js'
import { PLAN_APPROVAL_QUESTION_TOKEN } from './plan-approval-constants.js'

describe('plan-approval-resync', () => {
  it('round-trips pause marker on config', () => {
    const marker = {
      turnId: 't1',
      plan: [{ content: 'step', status: 'pending' as const }],
      question: PLAN_APPROVAL_QUESTION_TOKEN,
    }
    const cfg = withPlanApprovalPause(
      { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] },
      marker,
    )
    expect(readPlanApprovalPause(cfg)).toEqual(marker)
    const stripped = stripPlanApprovalPause(cfg)
    expect(readPlanApprovalPause(stripped)).toBeNull()
    expect((stripped as unknown as Record<string, unknown>)[PLAN_APPROVAL_PAUSE_KEY]).toBeUndefined()
    expect(withoutPlanApprovalPause(cfg)).toEqual(stripped)
  })

  it('readPlanApprovalPause falls back to PLAN_APPROVAL_QUESTION_TOKEN', () => {
    // Missing / empty question → token fallback (D5)
    const withEmptyQ = {
      llmProvider: 'deepseek' as const,
      model: 'deepseek-chat',
      tools: [] as string[],
      [PLAN_APPROVAL_PAUSE_KEY]: { turnId: 't2', plan: [] },
    }
    expect(readPlanApprovalPause(withEmptyQ as never)).toEqual({
      turnId: 't2',
      plan: [],
      question: PLAN_APPROVAL_QUESTION_TOKEN,
    })
  })

  it('round-trips markdown fields on pause marker', () => {
    const marker = {
      turnId: 't-md',
      plan: [{ content: 'a', status: 'pending' as const }],
      question: PLAN_APPROVAL_QUESTION_TOKEN,
      markdown: '# Plan\n\nDo the thing.',
      planPath: '/Users/test/.hip/plans/s1.md',
      markdownTruncated: false as boolean | undefined,
    }
    const cfg = withPlanApprovalPause(
      { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] },
      marker,
    )
    const read = readPlanApprovalPause(cfg)
    expect(read?.markdown).toBe('# Plan\n\nDo the thing.')
    expect(read?.planPath).toBe('/Users/test/.hip/plans/s1.md')
    // false is not stored as true — only true is set
    expect(read?.markdownTruncated).toBeUndefined()
  })

  it('round-trips markdownTruncated: true', () => {
    const marker = {
      turnId: 't-trunc',
      plan: [] as Array<{ content: string; status: 'pending' }>,
      question: PLAN_APPROVAL_QUESTION_TOKEN,
      markdown: 'clipped body',
      markdownTruncated: true,
    }
    const cfg = withPlanApprovalPause(
      { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] },
      marker,
    )
    expect(readPlanApprovalPause(cfg)?.markdownTruncated).toBe(true)
  })

  it('emitPlanApprovalResync sends published then interrupt with token question', () => {
    const sent: ServerMessage[] = []
    emitPlanApprovalResync(
      (m) => sent.push(m),
      's1',
      {
        turnId: 'turn-1',
        plan: [{ content: 'a', status: 'pending' }],
        question: PLAN_APPROVAL_QUESTION_TOKEN,
      },
    )
    expect(sent.map((m: ServerMessage) => m.type)).toEqual(['plan:published', 'agent:interrupt'])
    expect(sent[0]).toMatchObject({
      type: 'plan:published',
      sessionId: 's1',
      turnId: 'turn-1',
      plan: [{ content: 'a', status: 'pending' }],
    })
    expect(sent[1]).toMatchObject({
      type: 'agent:interrupt',
      sessionId: 's1',
      turnId: 'turn-1',
      agentId: 'supervisor',
      question: PLAN_APPROVAL_QUESTION_TOKEN,
    })
    const ctx = JSON.parse((sent[1] as { context?: string }).context ?? '{}')
    expect(ctx.kind).toBe('plan_approval')
    expect(ctx.markdown).toBeUndefined()
  })

  it('emitPlanApprovalResync includes markdown on plan:published, lean interrupt context', () => {
    const sent: ServerMessage[] = []
    emitPlanApprovalResync(
      (m) => sent.push(m),
      's-md',
      {
        turnId: 'turn-md',
        plan: [{ content: 'step', status: 'pending' }],
        question: 'Approve this plan?',
        markdown: '# Narrative plan\n\nDetails here.',
        planPath: '/tmp/plan.md',
        markdownTruncated: true,
      },
    )
    const published = sent[0] as Extract<ServerMessage, { type: 'plan:published' }>
    expect(published).toMatchObject({
      type: 'plan:published',
      sessionId: 's-md',
      turnId: 'turn-md',
      markdown: '# Narrative plan\n\nDetails here.',
      planPath: '/tmp/plan.md',
      markdownTruncated: true,
    })
    const ctx = JSON.parse((sent[1] as { context?: string }).context ?? '{}')
    expect(ctx).toEqual({
      kind: 'plan_approval',
      plan: [{ content: 'step', status: 'pending' }],
    })
    expect(ctx.markdown).toBeUndefined()
  })

  it('mergePlanApprovalPauseMarker never strips durable markdown', () => {
    const durable = {
      turnId: 't-rich',
      plan: [{ content: 'old', status: 'pending' as const }],
      question: 'Approve this plan?',
      markdown: '# Keep me',
      planPath: '/plans/s.md',
      markdownTruncated: true,
    }
    const stripped = {
      turnId: 't-rich',
      plan: [{ content: 'new', status: 'pending' as const }],
      question: 'Approve this plan?',
    }
    const merged = mergePlanApprovalPauseMarker(durable, stripped)
    expect(merged.markdown).toBe('# Keep me')
    expect(merged.planPath).toBe('/plans/s.md')
    expect(merged.markdownTruncated).toBe(true)
    expect(merged.plan).toEqual([{ content: 'new', status: 'pending' }])
  })

  it('mergePlanApprovalPauseMarker prefers next markdown when provided', () => {
    const durable = {
      turnId: 't1',
      plan: [],
      question: 'q',
      markdown: 'old body',
    }
    const next = {
      turnId: 't1',
      plan: [],
      question: 'q',
      markdown: 'fresh body',
      markdownTruncated: false,
    }
    const merged = mergePlanApprovalPauseMarker(durable, next)
    expect(merged.markdown).toBe('fresh body')
    expect(merged.markdownTruncated).toBe(false)
  })
})

describe('emitPlanApprovalResyncIfNeeded preserves markdown (KD-PA-12)', () => {
  it('persist rich marker → resync emit includes markdown and durable stays rich', async () => {
    // Lightweight Session-shaped double that exercises the preserve algorithm
    // without full Session construction.
    const { mergePlanApprovalPauseMarker, readPlanApprovalPause, withPlanApprovalPause, emitPlanApprovalResync } =
      await import('./plan-approval-resync.js')

    let config: Record<string, unknown> = {
      llmProvider: 'deepseek',
      model: 'deepseek-chat',
      tools: [],
    }
    const rich = {
      turnId: 'turn-preserve',
      plan: [{ content: 'step 1', status: 'pending' as const }],
      question: 'Approve this plan?',
      markdown: '# Plan body\n\nKeep across resync.',
      planPath: '/Users/test/.hip/plans/s-preserve.md',
      markdownTruncated: false as boolean | undefined,
    }
    config = withPlanApprovalPause(config as never, rich) as never

    // Simulate emitPlanApprovalResyncIfNeeded rebuild that used to wipe markdown:
    const durable = readPlanApprovalPause(config as never)
    expect(durable?.markdown).toBe(rich.markdown)

    const rebuiltOnly = {
      turnId: durable!.turnId,
      plan: durable!.plan,
      question: 'Approve this plan?',
    }
    // CRITICAL: merge before persist so rich fields survive
    const marker = mergePlanApprovalPauseMarker(durable, rebuiltOnly)
    config = withPlanApprovalPause(config as never, marker) as never

    const after = readPlanApprovalPause(config as never)
    expect(after?.markdown).toBe('# Plan body\n\nKeep across resync.')
    expect(after?.planPath).toBe('/Users/test/.hip/plans/s-preserve.md')

    const sent: ServerMessage[] = []
    emitPlanApprovalResync((m) => sent.push(m), 's-preserve', marker)
    const published = sent[0] as Extract<ServerMessage, { type: 'plan:published' }>
    expect(published.markdown).toBe('# Plan body\n\nKeep across resync.')
    expect(published.planPath).toBe('/Users/test/.hip/plans/s-preserve.md')

    // Interrupt remains lean
    const ctx = JSON.parse((sent[1] as { context?: string }).context ?? '{}')
    expect(ctx.markdown).toBeUndefined()
  })
})
