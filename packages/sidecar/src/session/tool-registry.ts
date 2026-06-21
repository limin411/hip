import type { StructuredToolInterface } from '@langchain/core/tools'
import type {
  Scope,
  MaterializePermissions,
  ToolCall,
  ToolCallResult,
  Materialization,
} from './tool-registry-types.js'

// Re-export public types + factory so callers import from one path.
export type {
  Scope,
  MaterializePermissions,
  ToolCall,
  ToolCallResult,
  Materialization,
} from './tool-registry-types.js'
export { createScope } from './tool-registry-types.js'

// ── Internals ────────────────────────────────────────────────────────────────

/** Internal record of one tool registration. */
interface Registration {
  readonly tool: StructuredToolInterface
  readonly scopeId: symbol | undefined
  /** Monotonic insertion order — larger is newer. */
  readonly order: number
}

/** Error string returned for any tool call whose registry has moved on. */
const STALE_MESSAGE = 'Tool registration changed after materialization'

// ── ToolRegistry ─────────────────────────────────────────────────────────────

/**
 * Scope-lifecycle tool registry with stale-call detection.
 *
 * Three lifecycle primitives:
 *   1. {@link register} — add a tool, optionally scoped. Returns an idempotent
 *      unregister function.
 *   2. {@link unregisterScope} — remove ALL tools registered under a scope.
 *   3. {@link materialize} — snapshot the registry into {@link Materialization}
 *      with `definitions` (for the LLM) and `settle` (for executing tool calls).
 *
 * Stale-call detection: every mutation bumps a monotonic `generation` counter.
 * Each {@link Materialization} captures the generation at snapshot time. If the
 * registry's live generation differs from the captured one when `settle()` is
 * invoked, the call is rejected with the `STALE_MESSAGE` error — because the
 * tool list the LLM saw no longer matches the registry, and executing the call
 * could invoke the wrong implementation.
 *
 * Precedence: when the same tool name is registered multiple times, the latest
 * registration wins for both {@link lookup} and {@link materialize}. Closing a
 * scope removes only that scope's registrations; older registrations of the
 * same name (from other scopes or from Application scope) become visible again.
 *
 * Design note — this registry does NOT replace {@link buildTools}; it wraps it.
 * Callers may feed `buildTools()` output into `register()` to layer scope
 * lifecycle and stale detection on top of the existing tool-building pipeline.
 */
export class ToolRegistry {
  /** name → registrations, newest last. Empty arrays are deleted. */
  private readonly registrations = new Map<string, Registration[]>()
  /** scopeId → set of tool names registered under that scope. */
  private readonly scopeIndex = new Map<symbol, Set<string>>()
  /** Monotonic mutation counter. Captured by materialize() for stale detection. */
  private generation = 0
  /** Monotonic insertion counter — used only to disambiguate "latest wins". */
  private nextOrder = 0

  // ── register ──────────────────────────────────────────────────────────

  /**
   * Register a tool, optionally under a scope.
   *
   * @returns an idempotent unregister function — calling it more than once is
   *          safe and has no effect after the first call.
   */
  register(tool: StructuredToolInterface, scope?: Scope): () => void {
    const name = tool.name
    const scopeId = scope?.id
    const registration: Registration = { tool, scopeId, order: this.nextOrder++ }

    const list = this.registrations.get(name)
    if (list) {
      list.push(registration)
    } else {
      this.registrations.set(name, [registration])
    }

    if (scopeId !== undefined) {
      const names = this.scopeIndex.get(scopeId) ?? new Set<string>()
      names.add(name)
      this.scopeIndex.set(scopeId, names)
    }

    this.bumpGeneration()

    let unregistered = false
    return () => {
      if (unregistered) return
      unregistered = true
      this.removeRegistration(name, registration)
    }
  }

  // ── unregisterScope ───────────────────────────────────────────────────

  /**
   * Remove all tools registered under the given scope. Application-scope
   * (no `Scope` argument) tools are never touched. Unknown scopes are a no-op.
   */
  unregisterScope(scope: Scope): void {
    const scopeId = scope.id
    const names = this.scopeIndex.get(scopeId)
    if (!names) return

    for (const name of names) {
      const list = this.registrations.get(name)
      if (!list) continue
      const filtered = list.filter((r) => r.scopeId !== scopeId)
      if (filtered.length === 0) {
        this.registrations.delete(name)
      } else if (filtered.length !== list.length) {
        this.registrations.set(name, filtered)
      }
    }

    this.scopeIndex.delete(scopeId)
    this.bumpGeneration()
  }

  // ── materialize ───────────────────────────────────────────────────────

  /**
   * Snapshot the registry into a {@link Materialization}.
   *
   * `definitions` reflects the latest registration of each name, filtered by
   * the optional `permissions`. `settle()` executes a tool call ONLY if the
   * registry has not been mutated since this snapshot; otherwise it returns
   * the stale-call error.
   */
  materialize(permissions?: MaterializePermissions): Materialization {
    const capturedGeneration = this.generation
    const definitions = this.collectDefinitions(permissions)
    const self = this

    const settle = async (call: ToolCall): Promise<ToolCallResult> => {
      // Generation drift ⇒ the LLM saw a different tool list than the registry
      // currently holds. Refuse to invoke to prevent silent wrong-tool calls.
      if (self.generation !== capturedGeneration) {
        return {
          content: STALE_MESSAGE,
          tool_call_id: call.callId,
          name: call.name,
        }
      }

      const tool = self.lookup(call.name)
      if (!tool) {
        return {
          content: `Error: unknown tool: ${call.name}`,
          tool_call_id: call.callId,
          name: call.name,
        }
      }

      try {
        const content = String(await tool.invoke(call.args))
        return {
          content,
          tool_call_id: call.callId,
          name: call.name,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: `Error: ${message}`,
          tool_call_id: call.callId,
          name: call.name,
        }
      }
    }

    return {
      definitions,
      settle,
      generation: capturedGeneration,
    }
  }

  // ── lookup ────────────────────────────────────────────────────────────

  /**
   * Find a tool by name. When duplicate registrations exist, the latest one
   * wins. Returns `undefined` when the name is unknown.
   */
  lookup(name: string): StructuredToolInterface | undefined {
    const list = this.registrations.get(name)
    if (!list || list.length === 0) return undefined
    return list[list.length - 1]!.tool
  }

  // ── size ──────────────────────────────────────────────────────────────

  /** Number of distinct tool names currently registered. */
  get size(): number {
    return this.registrations.size
  }

  // ── private helpers ───────────────────────────────────────────────────

  /**
   * Build the LLM-bound definitions list:
   *   1. For each name, take the latest registration.
   *   2. Apply `allowed` (whitelist) if non-empty.
   *   3. Apply `blocked` (blacklist).
   *   4. Sort by name for deterministic ordering.
   */
  private collectDefinitions(permissions?: MaterializePermissions): StructuredToolInterface[] {
    const allowed = permissions?.allowed
    const blocked = permissions?.blocked
    const hasAllowed = allowed !== undefined && allowed.length > 0

    const out: StructuredToolInterface[] = []
    for (const list of this.registrations.values()) {
      if (list.length === 0) continue
      const latest = list[list.length - 1]!
      const name = latest.tool.name
      if (hasAllowed && !allowed!.includes(name)) continue
      if (blocked !== undefined && blocked.length > 0 && blocked.includes(name)) continue
      out.push(latest.tool)
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }

  /**
   * Remove one specific registration. Bumps the generation exactly once
   * (idempotent at the call site — see {@link register}'s returned closure).
   */
  private removeRegistration(name: string, registration: Registration): void {
    const list = this.registrations.get(name)
    if (!list) {
      this.bumpGeneration()
      return
    }
    const idx = list.indexOf(registration)
    if (idx === -1) {
      this.bumpGeneration()
      return
    }
    list.splice(idx, 1)
    if (list.length === 0) {
      this.registrations.delete(name)
    }

    // Scope-index housekeeping: drop this name from the scope set when no
    // remaining registration under that scope still claims it.
    if (registration.scopeId !== undefined) {
      const names = this.scopeIndex.get(registration.scopeId)
      if (names) {
        const remaining = (this.registrations.get(name) ?? []).some(
          (r) => r.scopeId === registration.scopeId,
        )
        if (!remaining) names.delete(name)
        if (names.size === 0) this.scopeIndex.delete(registration.scopeId)
      }
    }

    this.bumpGeneration()
  }

  private bumpGeneration(): void {
    this.generation++
  }
}
