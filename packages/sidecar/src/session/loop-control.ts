import type { AgentLoopConfig } from '@hip/protocol'
import { readHipConfig } from '../config/hip-config.js'

/** Max model turns per user turn before the loop is forced to finish (OpenCode's value). */
export const MAX_STEPS = 800

/** A sub-agent's own loop cap (P3-J4), independent of the parent MAX_STEPS. Each `task` call is
 *  one parent step, so the parent cap bounds spawns; this bounds each child.
 *  25 covers multi-file research without hitting the text-only wrap-up mid-exploration
 *  (codebase questions often need ~15–20 tool rounds). */
export const CHILD_MAX_STEPS = 25

/**
 * Explore fixed-agent loop cap. Codebase search often needs more than the default child budget
 * before a usable summary; keep generic `task` workers on {@link CHILD_MAX_STEPS}.
 */
export const EXPLORE_CHILD_MAX_STEPS = 40

function positiveSteps(n: number | undefined, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/**
 * Resolve per-agent child step budget from an optional `agentLoop` section.
 * When `agentLoop` is omitted/undefined, returns the hard-coded defaults (25 / 40).
 */
export function childMaxStepsFromConfig(agentId: string, agentLoop?: AgentLoopConfig | null): number {
  if (agentId === 'explore') {
    return positiveSteps(agentLoop?.exploreChildMaxSteps, EXPLORE_CHILD_MAX_STEPS)
  }
  return positiveSteps(agentLoop?.childMaxSteps, CHILD_MAX_STEPS)
}

/** Per-agent child step budget for internal managed agents.
 *  Reads global hip.toml `[agentLoop]` when present; otherwise defaults 25/40. */
export function childMaxStepsForAgent(agentId: string): number {
  return childMaxStepsFromConfig(agentId, readHipConfig().agentLoop)
}

/** Injected as a system message on the final step: tools are off, answer in text only. */
export const MAX_STEPS_NOTE =
  'MAXIMUM STEPS REACHED. Tools are now disabled. Do not attempt any tool call. ' +
  'Do not emit DSML, XML tool markup, or function-call tags. ' +
  'Respond with a short plain-text summary of what you have done so far and what remains.'

/** Sub-agent max recursion depth. At depth >= MAX_DEPTH the task/dispatch_agent tools are filtered out. */
export const MAX_DEPTH = 3

/** LangGraph recursion limit for a loop capped at `maxSteps`. Each model turn now visits ~3 nodes
 *  (compact + agent + tools), plus occasional nudge/pause detours, so reserve headroom above
 *  3*maxSteps; our own step cap (not this limit) is the real stop condition. The arg-less default
 *  keeps the supervisor call site (recursionLimit()) unchanged; children pass CHILD_MAX_STEPS. */
export function recursionLimit(maxSteps: number = MAX_STEPS): number {
  return maxSteps * 3 + 10
}
