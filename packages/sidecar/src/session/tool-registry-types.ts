import type { StructuredToolInterface } from '@langchain/core/tools'

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Opaque scope handle. Registrations are tied to a scope object; closing the
 * scope removes exactly the registrations made under it (no other scope's
 * tools are touched). Application scope is represented by `undefined`.
 *
 * Precedence (when duplicates of the same tool name are registered):
 *   Session scope > Application scope — the latest registration always wins.
 */
export interface Scope {
  readonly id: symbol
}

/** Optional permission filter applied at {@link ToolRegistry.materialize} time. */
export interface MaterializePermissions {
  /** When non-empty, keep only tools whose name is in this list. */
  readonly allowed?: readonly string[]
  /** Drop any tool whose name is in this list. Applied after `allowed`. */
  readonly blocked?: readonly string[]
}

/** A single tool call passed to {@link Materialization.settle}. */
export interface ToolCall {
  readonly name: string
  readonly callId: string
  readonly args: Record<string, unknown>
}

/** A {@link ToolCall} result, structured to map directly onto a ToolMessage. */
export interface ToolCallResult {
  readonly content: string
  readonly tool_call_id: string
  readonly name: string
}

/**
 * Snapshot of the registry at a point in time, ready to be bound to an LLM
 * and settled against incoming tool calls.
 *
 * The `generation` field captures the registry's mutation counter at
 * materialization time. Any subsequent mutation (register / unregister /
 * unregisterScope) bumps the registry's live generation, so `settle()` can
 * detect stale calls — calls whose underlying registration may have moved,
 * been replaced by a different implementation, or disappeared entirely — and
 * refuse to execute them rather than silently invoking the wrong tool.
 */
export interface Materialization {
  /** Tools to bind to the LLM (already filtered by permissions). */
  readonly definitions: StructuredToolInterface[]
  /** Settle one tool call against the captured generation. */
  readonly settle: (call: ToolCall) => Promise<ToolCallResult>
  /** Generation captured at materialization time. Used for stale detection. */
  readonly generation: number
}

// ── Scope factory ────────────────────────────────────────────────────────────

/**
 * Create a fresh opaque {@link Scope}. Each call returns a distinct scope;
 * scopes are equality-compared by their `id` symbol, never by structural
 * equality, so two `createScope()` calls never collide.
 */
export function createScope(): Scope {
  return { id: Symbol('hip.tool-registry.scope') }
}
