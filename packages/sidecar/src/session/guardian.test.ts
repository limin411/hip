import { describe, it, expect, vi } from 'vitest'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { GuardianReviewer, FAIL_OPEN_REVIEW, type GuardianReview } from './guardian.js'

// ── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Fake ModelRunner that returns a pre-configured AIMessage. Optionally streams
 * text via onText (mirrors how RealModelRunner delivers content).
 */
class FakeRunner implements ModelRunner {
  constructor(
    private readonly response: AIMessage,
    private readonly streamText = true,
  ) {}

  async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    if (this.streamText) {
      const content = typeof this.response.content === 'string' ? this.response.content : ''
      if (content) opts.onText(content)
    }
    return this.response
  }
}

/** Runner that always throws — simulates a model failure. */
class ThrowingRunner implements ModelRunner {
  constructor(private readonly error: Error = new Error('model unavailable')) {}

  async run(): Promise<AIMessage> {
    throw this.error
  }
}

/** Build an AIMessage with plain-string content. */
function msg(content: string): AIMessage {
  return new AIMessage(content)
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GuardianReviewer', () => {
  // ── 1. high-risk tool → review() returns a GuardianReview ─────────────────
  it('returns a GuardianReview with a decision field for a high-risk tool', async () => {
    const runner = new FakeRunner(msg('{"decision":"allow","reasoning":"ok","confidence":0.9}'))
    const guardian = new GuardianReviewer({ modelRunner: runner })

    const result = await guardian.review({
      toolName: 'run_script',
      toolInput: { command: 'ls' },
      riskLevel: 'high',
    })

    expect(result).toBeDefined()
    expect(['allow', 'deny']).toContain(result.decision)
    expect(typeof result.reasoning).toBe('string')
    expect(typeof result.confidence).toBe('number')
  })

  // ── 2. guardian allows → decision='allow' ────────────────────────────────
  it("returns decision='allow' when the model approves", async () => {
    const runner = new FakeRunner(msg('{"decision":"allow","reasoning":"safe operation","confidence":0.95}'))
    const guardian = new GuardianReviewer({ modelRunner: runner })

    const result = await guardian.review({
      toolName: 'run_script',
      toolInput: { command: 'echo hi' },
      riskLevel: 'high',
    })

    expect(result.decision).toBe('allow')
    expect(result.reasoning).toBe('safe operation')
    expect(result.confidence).toBeCloseTo(0.95)
  })

  // ── 3. guardian denies → decision='deny' with reasoning ──────────────────
  it("returns decision='deny' with reasoning when the model refuses", async () => {
    const runner = new FakeRunner(msg('{"decision":"deny","reasoning":"rm -rf is destructive","confidence":0.88}'))
    const guardian = new GuardianReviewer({ modelRunner: runner })

    const result = await guardian.review({
      toolName: 'run_script',
      toolInput: { command: 'rm -rf /' },
      riskLevel: 'high',
    })

    expect(result.decision).toBe('deny')
    expect(result.reasoning).toContain('destructive')
    expect(result.confidence).toBeCloseTo(0.88)
  })

  // ── 4. low-risk → caller responsibility (no built-in filter) ──────────────
  it('does not short-circuit on low risk — caller is responsible for filtering', async () => {
    // The spec says: "Do NOT block low/medium risk tools with guardian" and
    // "(caller checks risk first)". GuardianReviewer.review() performs no
    // risk-based filtering — it reviews whatever it is asked to review.
    // ToolRunner (the caller) is responsible for only invoking review() when
    // riskLevel === 'high'.
    const runner = new FakeRunner(msg('{"decision":"allow","reasoning":"low risk","confidence":1.0}'))
    const runSpy = vi.spyOn(runner, 'run')
    const guardian = new GuardianReviewer({ modelRunner: runner })

    const result = await guardian.review({
      toolName: 'read_file',
      toolInput: { path: '/tmp/x' },
      riskLevel: 'low',
    })

    // GuardianReviewer does not gate — the model was still called.
    expect(runSpy).toHaveBeenCalledTimes(1)
    expect(result.decision).toBe('allow')
  })

  // ── 5. guardian model throws → fail-open (allow) ─────────────────────────
  it('fails open with allow when the model runner throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const guardian = new GuardianReviewer({ modelRunner: new ThrowingRunner() })

    const result = await guardian.review({
      toolName: 'run_script',
      toolInput: { command: 'ls' },
      riskLevel: 'high',
    })

    expect(result.decision).toBe('allow')
    expect(result.reasoning).toMatch(/fail-open/)
    expect(result.confidence).toBe(0)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  // ── 6. guardian returns malformed JSON → fail-open (allow) ───────────────
  it('fails open with allow when the model returns malformed JSON', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runner = new FakeRunner(msg('this is not json at all'))
    const guardian = new GuardianReviewer({ modelRunner: runner })

    const result = await guardian.review({
      toolName: 'run_script',
      toolInput: { command: 'ls' },
      riskLevel: 'high',
    })

    expect(result.decision).toBe('allow')
    expect(result.reasoning).toMatch(/fail-open/)
    expect(result.confidence).toBe(0)
    warnSpy.mockRestore()
  })

  // ── 7. valid JSON with decision field → parsed correctly ─────────────────
  it('parses valid JSON embedded in surrounding prose', async () => {
    const runner = new FakeRunner(msg('Sure! Here is my review:\n{"decision":"deny","reasoning":"too broad","confidence":0.7}\nDone.'))
    const guardian = new GuardianReviewer({ modelRunner: runner })

    const result = await guardian.review({
      toolName: 'run_script',
      toolInput: { command: 'dd if=/dev/zero of=/dev/sda' },
      riskLevel: 'high',
    })

    expect(result.decision).toBe('deny')
    expect(result.reasoning).toBe('too broad')
    expect(result.confidence).toBeCloseTo(0.7)
  })

  // ── 8. prompt template threads all inputs into the model call ─────────────
  it('threads toolName, riskLevel, toolInput and context into the review prompt', async () => {
    let captured: BaseMessage[] = []
    const capturingRunner: ModelRunner = {
      async run(messages: BaseMessage[]): Promise<AIMessage> {
        captured = messages
        return msg('{"decision":"allow","reasoning":"ok","confidence":1.0}')
      },
    }
    const guardian = new GuardianReviewer({ modelRunner: capturingRunner })

    await guardian.review({
      toolName: 'run_script',
      toolInput: { command: 'rm -rf /tmp/x' },
      riskLevel: 'high',
      context: 'Cleaning up tmp directory',
    })

    const joined = captured
      .map((m) => {
        const c = m.content
        return typeof c === 'string' ? c : ''
      })
      .join('\n')

    expect(joined).toContain('run_script')
    expect(joined).toContain('high')
    expect(joined).toContain('rm -rf /tmp/x')
    expect(joined).toContain('Cleaning up tmp directory')
    expect(joined).toContain('security guardian')
  })

  // ── 9. confidence clamped to [0, 1] ───────────────────────────────────────
  it('clamps out-of-range confidence values to [0, 1]', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const high = new FakeRunner(msg('{"decision":"allow","reasoning":"ok","confidence":1.5}'))
    const g1 = new GuardianReviewer({ modelRunner: high })
    const r1 = await g1.review({ toolName: 't', toolInput: {}, riskLevel: 'high' })
    expect(r1.confidence).toBe(1)

    const low = new FakeRunner(msg('{"decision":"allow","reasoning":"ok","confidence":-0.5}'))
    const g2 = new GuardianReviewer({ modelRunner: low })
    const r2 = await g2.review({ toolName: 't', toolInput: {}, riskLevel: 'high' })
    expect(r2.confidence).toBe(0)
    warnSpy.mockRestore()
  })

  // ── 10. non-streaming runner (no onText) still works via AIMessage content ─
  it('extracts text from AIMessage.content when the runner does not stream', async () => {
    const runner = new FakeRunner(
      msg('{"decision":"deny","reasoning":"no stream","confidence":0.5}'),
      /* streamText */ false,
    )
    const guardian = new GuardianReviewer({ modelRunner: runner })

    const result = await guardian.review({
      toolName: 'run_script',
      toolInput: {},
      riskLevel: 'high',
    })

    expect(result.decision).toBe('deny')
    expect(result.reasoning).toBe('no stream')
  })

  // ── 11. invalid decision value → fail-open ────────────────────────────────
  it('fails open when decision is not allow or deny', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runner = new FakeRunner(msg('{"decision":"maybe","reasoning":"unsure","confidence":0.3}'))
    const guardian = new GuardianReviewer({ modelRunner: runner })

    const result = await guardian.review({
      toolName: 'run_script',
      toolInput: {},
      riskLevel: 'high',
    })

    expect(result.decision).toBe('allow')
    expect(result.reasoning).toMatch(/fail-open/)
    warnSpy.mockRestore()
  })

  // ── 12. missing reasoning → fail-open ─────────────────────────────────────
  it('fails open when reasoning is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runner = new FakeRunner(msg('{"decision":"allow","confidence":0.9}'))
    const guardian = new GuardianReviewer({ modelRunner: runner })

    const result = await guardian.review({
      toolName: 'run_script',
      toolInput: {},
      riskLevel: 'high',
    })

    expect(result.decision).toBe('allow')
    expect(result.reasoning).toMatch(/fail-open/)
    warnSpy.mockRestore()
  })

  // ── 13. maxTokens default and override ────────────────────────────────────
  it('defaults maxTokens to 200 and accepts an override', async () => {
    const runner = new FakeRunner(msg('{"decision":"allow","reasoning":"ok","confidence":1.0}'))
    const spy = vi.spyOn(runner, 'run')

    const gDefault = new GuardianReviewer({ modelRunner: runner })
    await gDefault.review({ toolName: 't', toolInput: {}, riskLevel: 'high' })
    // The default maxTokens is reflected in the prompt guidance ("under 200 tokens").
    const promptDefault = extractPrompt(spy.mock.calls[0]![0])
    expect(promptDefault).toMatch(/200/)

    const gOverride = new GuardianReviewer({ modelRunner: runner, maxTokens: 350 })
    await gOverride.review({ toolName: 't', toolInput: {}, riskLevel: 'high' })
    const promptOverride = extractPrompt(spy.mock.calls[1]![0])
    expect(promptOverride).toMatch(/350/)
  })

  // ── 14. FAIL_OPEN_REVIEW sentinel ─────────────────────────────────────────
  it('exports a FAIL_OPEN_REVIEW sentinel with the documented fail-open shape', () => {
    expect(FAIL_OPEN_REVIEW.decision).toBe('allow')
    expect(FAIL_OPEN_REVIEW.confidence).toBe(0)
    expect(FAIL_OPEN_REVIEW.reasoning).toMatch(/fail-open/i)
  })
})

// ── Local helpers ────────────────────────────────────────────────────────────

/** Pull the joined prompt text out of the messages array handed to ModelRunner.run. */
function extractPrompt(messages: BaseMessage[]): string {
  return messages
    .map((m) => {
      const c = m.content
      return typeof c === 'string' ? c : ''
    })
    .join('\n')
}

// Compile-time guard: the fail-open sentinel satisfies the GuardianReview contract.
const _typeCheck: GuardianReview = FAIL_OPEN_REVIEW
void _typeCheck
