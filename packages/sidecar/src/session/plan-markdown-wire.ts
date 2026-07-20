/**
 * Plan markdown wire transport (design D2 / KD-PA-5 / KD-PA-10).
 *
 * Caps plan.md body on plan:published + durable pause marker.
 * Same magnitude as DELEGATE_BLOB_CAP / REASONING_CAP (32768), NOT TOOL_BLOB_CAP (4096).
 */

/** Wire/storage cap for plan.md markdown (UTF-16 code units via string.length). */
export const PLAN_MARKDOWN_WIRE_CAP = 32_768

const TRUNC_SUFFIX = '\n\n…(truncated)'

/**
 * Clip plan markdown for wire + durable pause marker.
 *
 * Measure with JS string.length (UTF-16 code units), matching tool-trace clip().
 * Truncation suffix is placed **inside** the cap so final text.length is always
 * <= PLAN_MARKDOWN_WIRE_CAP.
 */
export function clipPlanMarkdown(raw: string): { text: string; truncated: boolean } {
  if (!raw) return { text: '', truncated: false }
  if (raw.length <= PLAN_MARKDOWN_WIRE_CAP) return { text: raw, truncated: false }
  const budget = PLAN_MARKDOWN_WIRE_CAP - TRUNC_SUFFIX.length
  // budget > 0 because CAP >> suffix length
  return { text: raw.slice(0, budget) + TRUNC_SUFFIX, truncated: true }
}
