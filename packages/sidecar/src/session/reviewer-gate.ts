/**
 * Reviewer Gate — an adversarial code reviewer that uses an LLM agent
 * to verify code diffs for correctness, security, idioms, completeness,
 * and regression risk.
 *
 * The reviewer is created via the `createReviewerGate` factory, which
 * accepts a minimal model-invocation interface (`GateModelRunner`).
 * This is intentionally separate from the streaming-oriented `ModelRunner`
 * (model-runner.ts), since the reviewer only needs a one-shot prompt.
 */

import type { VerificationGate, GateContext, GateResult, GateFailure } from '../orchestrator/verification-gate.js'
import type { BaseMessage, AIMessage } from '@langchain/core/messages'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'

// ── Gate-specific interfaces ─────────────────────────────────────────

/**
 * Minimal model invocation interface for gates.
 *
 * Unlike `ModelRunner` (model-runner.ts), which is streaming- and
 * tool-oriented, this is a simple invoke-and-return interface suitable
 * for one-shot reviewer prompts.  The `invoke` method is compatible
 * with `BaseChatModel.invoke()` from `@langchain/core`.
 */
export interface GateModelRunner {
  invoke(messages: BaseMessage[]): Promise<AIMessage>
}

/**
 * Reviewer-specific gate context.
 * Extends the base `GateContext` with the diff to review and the
 * original task prompt that produced it.
 */
export interface ReviewerContext extends GateContext {
  /** The git diff of changes made by the coder. */
  diff: string
  /** The original task prompt. */
  originalPrompt: string
}

// ── System prompt ────────────────────────────────────────────────────

const REVIEWER_SYSTEM_PROMPT = `You are a strict code reviewer. Review the following diff against the original task requirements.

Check for:
1. **Correctness**: Does the code correctly implement the requirements?
2. **Security**: Are there any security vulnerabilities (injection, XSS, exposed secrets)?
3. **Idioms**: Does the code follow the project's conventions?
4. **Completeness**: Are edge cases handled? Are there TODOs left behind?
5. **Regression risk**: Could this change break existing functionality?

Respond in this exact JSON format:
{
  "approved": true/false,
  "issues": [
    { "severity": "error"|"warning", "file": "path/to/file", "line": 123, "message": "description" }
  ],
  "suggestions": ["suggestion 1", "suggestion 2"]
}

If there are any "error" severity issues, approved MUST be false.`

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Create a `VerificationGate` that uses an LLM agent to review code diffs.
 *
 * The reviewer invokes the provided model runner with a system prompt and
 * the diff / original task context, then parses the JSON-structured response
 * to determine whether the changes pass the adversarial review.
 *
 * @param runner - A model invoker (e.g. a `BaseChatModel` or test stub).
 * @returns A `VerificationGate` with kind `'reviewer'`.
 */
export function createReviewerGate(runner: GateModelRunner): VerificationGate {
  return {
    kind: 'reviewer',
    description: 'Adversarial code review by an independent agent',

    async run(ctx: GateContext): Promise<GateResult> {
      const startedAt = Date.now()
      const rctx = ctx as ReviewerContext

      // Empty diff → trivially pass (nothing to review)
      if (!rctx.diff) {
        return {
          passed: true,
          failures: [],
          suggestions: ['No diff to review'],
          durationMs: Date.now() - startedAt,
        }
      }

      const messages: BaseMessage[] = [
        new SystemMessage(REVIEWER_SYSTEM_PROMPT),
        new HumanMessage(
          `Original task: ${rctx.originalPrompt}\n\nDiff to review:\n\`\`\`diff\n${rctx.diff}\n\`\`\``,
        ),
      ]

      // Invoke the model
      let response: AIMessage
      try {
        response = await runner.invoke(messages)
      } catch (err: unknown) {
        return {
          passed: false,
          failures: [{
            message: `Reviewer model invocation failed: ${(err as Error).message ?? String(err)}`,
            severity: 'error',
          }],
          suggestions: ['Check model connectivity and re-run the review'],
          durationMs: Date.now() - startedAt,
        }
      }

      // Extract text content from the response
      const text = typeof response.content === 'string'
        ? response.content
        : (response.content as Array<{ text?: string }>).map(c => c.text ?? '').join('')

      // Attempt to parse the JSON response
      try {
        // The response may be wrapped in markdown code fences; search for the JSON object
        const jsonMatch = text.match(/\{[\s\S]*"approved"[\s\S]*\}/)
        if (!jsonMatch) {
          return {
            passed: false,
            failures: [{ message: 'Reviewer response could not be parsed', severity: 'error' }],
            suggestions: [text.slice(0, 500)],
            durationMs: Date.now() - startedAt,
          }
        }

        const parsed = JSON.parse(jsonMatch[0])
        const failures: GateFailure[] = (parsed.issues ?? []).map((i: Record<string, unknown>) => ({
          message: String(i.message ?? ''),
          file: i.file != null ? String(i.file) : undefined,
          line: i.line != null ? Number(i.line) : undefined,
          severity: (i.severity === 'error' ? 'error' : 'warning') as 'error' | 'warning',
        }))

        const errorFailures = failures.filter(f => f.severity === 'error')

        return {
          passed: parsed.approved !== false && errorFailures.length === 0,
          failures,
          suggestions: Array.isArray(parsed.suggestions)
            ? parsed.suggestions.map(String)
            : [],
          durationMs: Date.now() - startedAt,
        }
      } catch {
        return {
          passed: false,
          failures: [{ message: 'Reviewer produced invalid JSON', severity: 'error' }],
          suggestions: ['Re-run review with a different model or retry'],
          durationMs: Date.now() - startedAt,
        }
      }
    },
  }
}
