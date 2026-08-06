/**
 * Shared token-estimation constants (single source of truth for UI + sidecar).
 * Heuristic aligned with Codex / OpenCode / grok-build xai-token-estimation.
 */

/** Industry-standard heuristic: ≈4 chars (UTF-16 code units / bytes) per token. */
export const CHARS_PER_TOKEN = 4

/** Per-image approximate token cost (low-resolution image patches). */
export const IMAGE_TOKEN_ESTIMATE = 765

/** Fixed per-tool schema overhead chars when schema JSON is unavailable. */
export const TOOL_SCHEMA_OVERHEAD_CHARS = 400

/** Default cap for OC-style usable buffer reservation (min with maxOutput). */
export const DEFAULT_OUTPUT_BUFFER_CAP = 20_000
