/** Doom-loop detection: an identical batch of tool calls repeated N times in a row. */

export const DOOM_LOOP_N = 3

/** How many recent EXECUTED batch signatures to retain for the consecutive-repeat check. */
export const SIG_WINDOW = 6

/** Corrective note injected after the Nth identical batch, before the next model turn. */
export const DOOM_LOOP_NUDGE =
  '你已经用完全相同的参数重复调用了同一个工具多次，但没有取得进展。' +
  '请停止重复——换一种完全不同的方法，或者如果确实无法继续，就直接用文字说明情况并结束。'

/** Question shown to the user when the loop is still stuck after the nudge. */
export const PAUSE_QUESTION =
  '我反复在做同一个操作但没有进展。需要你指个方向：换个思路、跳过这一步，还是先停下？'

interface ToolCallLike {
  name: string
  args: unknown
}

/** Stable signature for one batch of tool calls: each `name:JSON(args)`, sorted then joined.
 *  Identical repeated calls serialize identically, so equality detects a repeat regardless of how
 *  many calls the batch holds or their order. */
export function sigOf(calls: readonly ToolCallLike[]): string {
  return calls.map((c) => `${c.name}:${JSON.stringify(c.args)}`).sort().join('|')
}

/** How many of the most recent signatures (counting back from the tail) equal `sig`. */
export function trailingRepeatCount(sigs: readonly string[], sig: string): number {
  let n = 0
  for (let i = sigs.length - 1; i >= 0 && sigs[i] === sig; i--) n++
  return n
}
