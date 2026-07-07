/**
 * Tests for the ReviewerGate.
 *
 * Uses a local `FakeGateModelRunner` implementation that returns
 * pre-configured response strings, avoiding any real LLM calls.
 */

import { describe, it, expect } from 'vitest'
import { createReviewerGate } from './reviewer-gate.js'
import type { ReviewerContext, GateModelRunner } from './reviewer-gate.js'
import { AIMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'

// ── Fake model runner for testing ────────────────────────────────────

class FakeGateModelRunner implements GateModelRunner {
  private idx = 0

  constructor(private readonly responses: string[]) {}

  async invoke(_messages: BaseMessage[]): Promise<AIMessage> {
    const content = this.responses[this.idx] ?? ''
    this.idx++
    return new AIMessage({ content })
  }

  /** Reset the invocation counter (useful when reusing the same instance). */
  reset(): void {
    this.idx = 0
  }
}

// ── Test helpers ─────────────────────────────────────────────────────

const baseCtx: ReviewerContext = {
  cwd: '/tmp/test',
  sessionId: 's1',
  runId: 'r1',
  diff: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-const x = 1\n+const x = 2',
  originalPrompt: 'Change x from 1 to 2',
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ReviewerGate', () => {
  it('passes when reviewer approves with no issues', async () => {
    const runner = new FakeGateModelRunner([
      JSON.stringify({ approved: true, issues: [], suggestions: ['LGTM'] }),
    ])
    const gate = createReviewerGate(runner)
    const result = await gate.run(baseCtx)

    expect(result.passed).toBe(true)
    expect(result.failures).toHaveLength(0)
    expect(result.suggestions).toEqual(['LGTM'])
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('passes when reviewer warns but has no errors', async () => {
    const runner = new FakeGateModelRunner([
      JSON.stringify({
        approved: true,
        issues: [
          { severity: 'warning', file: 'src/foo.ts', line: 2, message: 'Consider adding a type annotation' },
        ],
        suggestions: ['Add a type annotation for clarity'],
      }),
    ])
    const gate = createReviewerGate(runner)
    const result = await gate.run(baseCtx)

    expect(result.passed).toBe(true)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].severity).toBe('warning')
  })

  it('fails when reviewer reports error-severity issues', async () => {
    const runner = new FakeGateModelRunner([
      JSON.stringify({
        approved: false,
        issues: [
          { severity: 'error', file: 'src/foo.ts', line: 1, message: 'Missing null check before accessing x' },
        ],
        suggestions: ['Add null check before accessing x'],
      }),
    ])
    const gate = createReviewerGate(runner)
    const result = await gate.run(baseCtx)

    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].severity).toBe('error')
    expect(result.failures[0].message).toContain('null check')
    expect(result.failures[0].file).toBe('src/foo.ts')
    expect(result.failures[0].line).toBe(1)
  })

  it('fails when approved is false even with no issues', async () => {
    const runner = new FakeGateModelRunner([
      JSON.stringify({ approved: false, issues: [], suggestions: ['This approach is too risky'] }),
    ])
    const gate = createReviewerGate(runner)
    const result = await gate.run(baseCtx)

    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(0)
  })

  it('passes when diff is empty (nothing to review)', async () => {
    const runner = new FakeGateModelRunner([])
    const gate = createReviewerGate(runner)
    const result = await gate.run({ ...baseCtx, diff: '' } as ReviewerContext)

    expect(result.passed).toBe(true)
    expect(result.suggestions).toEqual(['No diff to review'])
  })

  it('handles malformed reviewer response (not JSON at all)', async () => {
    const runner = new FakeGateModelRunner(['not valid JSON at all'])
    const gate = createReviewerGate(runner)
    const result = await gate.run(baseCtx)

    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].message).toContain('could not be parsed')
  })

  it('handles JSON response wrapped in markdown code fences', async () => {
    const runner = new FakeGateModelRunner([
      'Here is my review:\n```json\n{"approved": true, "issues": [], "suggestions": ["LGTM"]}\n```',
    ])
    const gate = createReviewerGate(runner)
    const result = await gate.run(baseCtx)

    expect(result.passed).toBe(true)
    expect(result.suggestions).toEqual(['LGTM'])
  })

  it('handles model invocation failure gracefully', async () => {
    // Runner that always throws
    const brokenRunner: GateModelRunner = {
      async invoke() {
        throw new Error('Network error')
      },
    }
    const gate = createReviewerGate(brokenRunner)
    const result = await gate.run(baseCtx)

    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].message).toContain('model invocation failed')
  })

  it('handles mixed error + warning issues — errors force rejection', async () => {
    const runner = new FakeGateModelRunner([
      JSON.stringify({
        approved: false,
        issues: [
          { severity: 'error', file: 'src/main.ts', line: 42, message: 'SQL injection risk in query builder' },
          { severity: 'warning', file: 'src/main.ts', line: 10, message: 'Unused import detected' },
        ],
        suggestions: ['Use parameterized queries', 'Remove unused import'],
      }),
    ])
    const gate = createReviewerGate(runner)
    const result = await gate.run(baseCtx)

    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(2)
    const errorFailures = result.failures.filter(f => f.severity === 'error')
    expect(errorFailures).toHaveLength(1)
    expect(errorFailures[0].file).toBe('src/main.ts')
  })
})
