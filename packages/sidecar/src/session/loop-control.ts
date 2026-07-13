import type { AgentLoopConfig } from '@hip/protocol'
import { readHipConfig, resolveEffectiveConfig } from '../config/hip-config.js'

/**
 * Default supervisor model turns per user turn before the loop is forced to finish.
 * High ceiling (OpenCode-inspired; OpenCode itself defaults to unbounded).
 * Hermes uses agent.max_turns=90 — tighter; hip relies on doom-loop / error-streak
 * as practical brakes. Override via hip.toml `[agentLoop].maxSteps`.
 */
export const MAX_STEPS = 800

/**
 * Default sub-agent loop cap, independent of the parent maxSteps.
 * Each `task` call is one parent step; this bounds each child.
 * 25 covers multi-file research without mid-exploration wrap-up
 * (codebase questions often need ~15–20 tool rounds). Hermes delegation
 * default is 50 — hip stays lower for fan-out cost. Override via
 * `[agentLoop].childMaxSteps`.
 */
export const CHILD_MAX_STEPS = 25

/**
 * Default explore fixed-agent loop cap. Codebase search often needs more than
 * the generic child budget. Override via `[agentLoop].exploreChildMaxSteps`.
 */
export const EXPLORE_CHILD_MAX_STEPS = 40

/**
 * Default sub-agent max recursion depth. At depth >= maxDepth the
 * task/dispatch_agent tools are filtered out. Override via `[agentLoop].maxDepth`.
 */
export const MAX_DEPTH = 3

function positiveSteps(n: number | undefined, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/** Resolve agentLoop for a session cwd (project overrides global), or global-only. */
export function agentLoopFor(cwd?: string | null): AgentLoopConfig | undefined {
  if (cwd && cwd.trim()) return resolveEffectiveConfig(cwd).agentLoop
  return readHipConfig().agentLoop
}

/** Supervisor step budget from an optional agentLoop section. */
export function maxStepsFromConfig(agentLoop?: AgentLoopConfig | null): number {
  return positiveSteps(agentLoop?.maxSteps, MAX_STEPS)
}

/** Supervisor step budget from hip.toml (optional cwd for project override). */
export function maxStepsForSession(cwd?: string | null): number {
  return maxStepsFromConfig(agentLoopFor(cwd))
}

/** Sub-agent recursion depth from an optional agentLoop section. */
export function maxDepthFromConfig(agentLoop?: AgentLoopConfig | null): number {
  return positiveSteps(agentLoop?.maxDepth, MAX_DEPTH)
}

/** Sub-agent recursion depth from hip.toml (optional cwd for project override). */
export function maxDepthForSession(cwd?: string | null): number {
  return maxDepthFromConfig(agentLoopFor(cwd))
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

/**
 * Per-agent child step budget for internal managed agents.
 * When `cwd` is provided, uses resolveEffectiveConfig (project overrides global);
 * otherwise reads global HIP_CONFIG_PATH only.
 */
export function childMaxStepsForAgent(agentId: string, cwd?: string | null): number {
  return childMaxStepsFromConfig(agentId, agentLoopFor(cwd))
}

/** Injected as a system message on the final step: tools are off, answer in text only. */
export const MAX_STEPS_NOTE =
  'MAXIMUM STEPS REACHED. Tools are now disabled. Do not attempt any tool call. ' +
  'Do not emit DSML, XML tool markup, or function-call tags. ' +
  'Respond with a short plain-text summary of what you have done so far and what remains.'

/** LangGraph recursion limit for a loop capped at `maxSteps`. Each model turn now visits ~3 nodes
 *  (compact + agent + tools), plus occasional nudge/pause detours, so reserve headroom above
 *  3*maxSteps; our own step cap (not this limit) is the real stop condition. The arg-less default
 *  keeps the supervisor call site (recursionLimit()) unchanged; children pass their child budget. */
export function recursionLimit(maxSteps: number = MAX_STEPS): number {
  return maxSteps * 3 + 10
}
