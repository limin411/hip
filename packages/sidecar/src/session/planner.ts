/**
 * Multi-mode planner: adaptive + reactive planning beyond the single
 * {@link planNode} in `graph.ts`.
 *
 * Three modes (per turn):
 *  - `'never'`    — skip planning entirely
 *  - `'always'`   — always plan (mirrors the current single-`planNode` flow)
 *  - `'adaptive'` — plan iff the user task looks complex (long message,
 *                   planning keywords like "plan"/"design"/"architecture"/
 *                   "refactor", or ≥2 distinct file paths referenced)
 *
 * Reactive re-planning: after ≥2 tool errors mid-execution, inject a
 * re-planning SystemMessage so the agent can revise its approach. The
 * "max 1 replan per turn" invariant is enforced structurally via
 * {@link TurnReplanGuard} so callers cannot accidentally double-inject.
 *
 * This module is pure logic — no LangGraph / model dependencies. The caller
 * (graph.ts) wires the decisions into the StateGraph; future todos integrate
 * without changing this file.
 */

/** How aggressively the agent should plan before executing. */
export type PlanMode = 'adaptive' | 'always' | 'never'

/** Inputs to {@link shouldPlanComplex}. */
export interface PlannerInput {
  userMessage: string
  /** Running count of tool errors observed this turn (informational for adaptive mode). */
  toolErrorCount: number
  planMode: PlanMode
}

/** What the agent should do at the planning boundary. */
export type PlannerMode = 'skip' | 'plan' | 'replan'

/** Decision returned by {@link shouldPlanComplex}. */
export interface PlannerDecision {
  shouldPlan: boolean
  reason: string
  mode: PlannerMode
}

/** Tool-error count at or above which reactive re-planning kicks in. */
export const REPLAN_ERROR_THRESHOLD = 2

/** Cap on how many error lines are inlined into the replan prompt. */
const MAX_INLINE_ERRORS = 5

/**
 * Reactive re-planning trigger. Returns true when the running tool-error
 * count for this turn reaches {@link REPLAN_ERROR_THRESHOLD}.
 *
 * Callers MUST additionally consult a {@link TurnReplanGuard} (or equivalent
 * turn-local state) to enforce the "max 1 replan per turn" invariant — this
 * function is intentionally stateless.
 */
export function shouldReplan(toolErrorCount: number): boolean {
  return toolErrorCount >= REPLAN_ERROR_THRESHOLD
}

const REPLAN_PROMPT_HEADER = 'Replanning required: recent tool calls failed.'
const REPLAN_PROMPT_BODY =
  'Revise your approach before continuing. Re-evaluate the failing steps, consider an alternative path, then produce a fresh plan via the write_todos tool before resuming execution.'

/**
 * Build the re-planning injection message. The caller wraps this string in a
 * `SystemMessage` and prepends it to the agent's next turn.
 *
 * The error list is truncated to {@link MAX_INLINE_ERRORS} entries to bound
 * prompt size; further errors are summarised by count so the agent still
 * knows the full scale of the failure.
 */
export function buildReplanPrompt(errors: string[]): string {
  const inline = errors.slice(0, MAX_INLINE_ERRORS)
  const overflow = Math.max(0, errors.length - inline.length)
  const errorLines = inline.map((e, i) => `  ${i + 1}. ${e}`).join('\n')
  const overflowLine = overflow > 0 ? `\n  ... and ${overflow} more error(s)` : ''
  return [
    REPLAN_PROMPT_HEADER,
    '',
    `Failed tool calls (last ${inline.length}):`,
    errorLines + overflowLine,
    '',
    REPLAN_PROMPT_BODY,
  ].join('\n')
}

/**
 * Turn-local guard enforcing the "max 1 replan per turn" invariant
 * (task constraint #5). Construct one at the start of each agent turn;
 * call {@link TurnReplanGuard.markReplanned} after injecting a replan prompt
 * so subsequent calls to {@link TurnReplanGuard.canReplan} return false.
 */
export class TurnReplanGuard {
  private replanned = false

  canReplan(): boolean {
    return !this.replanned
  }

  markReplanned(): void {
    this.replanned = true
  }

  get hasReplanned(): boolean {
    return this.replanned
  }
}

/** Output of {@link decideReplan}: whether to inject a replan, and the prompt if so. */
export interface ReplanDecision {
  replan: boolean
  /** SystemMessage content to inject; `null` when {@link ReplanDecision.replan} is false. */
  prompt: string | null
  reason: string
}

/**
 * One-shot integration helper for reactive re-planning. Combines
 * {@link shouldReplan}, {@link TurnReplanGuard}, and {@link buildReplanPrompt}
 * into a single decision so graph.ts has one call-site.
 *
 * - If the guard has already replanned this turn → `{ replan: false }`.
 * - If error count is below threshold → `{ replan: false }`.
 * - Otherwise → mark the guard consumed and return the prompt to inject.
 */
export function decideReplan(errors: string[], guard: TurnReplanGuard): ReplanDecision {
  if (!guard.canReplan()) {
    return { replan: false, prompt: null, reason: 'already replanned this turn' }
  }
  if (!shouldReplan(errors.length)) {
    return {
      replan: false,
      prompt: null,
      reason: `only ${errors.length} tool error(s) (threshold ${REPLAN_ERROR_THRESHOLD})`,
    }
  }
  guard.markReplanned()
  return {
    replan: true,
    prompt: buildReplanPrompt(errors),
    reason: `${errors.length} tool errors triggered replan`,
  }
}
