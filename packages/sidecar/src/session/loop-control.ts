/** Max model turns per user turn before the loop is forced to finish (OpenCode's value). */
export const MAX_STEPS = 25

/** Injected as a system message on the final step: tools are off, answer in text only. */
export const MAX_STEPS_NOTE =
  'MAXIMUM STEPS REACHED. Tools are now disabled. Do not attempt any tool call. ' +
  'Respond with a short plain-text summary of what you have done so far and what remains.'

/** LangGraph recursion limit. Each model turn is ~2 node visits (agent + tools), so reserve headroom
 *  above 2*MAX_STEPS; our own step cap (not this limit) is the real stop condition. */
export function recursionLimit(): number {
  return MAX_STEPS * 2 + 5
}
