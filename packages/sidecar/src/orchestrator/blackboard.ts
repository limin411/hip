/**
 * Per-workflow key-value store with namespace isolation.
 *
 * Each workflow run gets its own namespace (keyed by runId).
 * `BlackboardNamespace` provides typed get/set/delete/has/list/clear
 * and an atomic compare-and-swap (cas) operation.
 *
 * Integration:
 * - Pass a `Blackboard` instance into `DurableRunOpts.blackboard`.
 * - The executor obtains `blackboard.namespace(runId)` and makes it
 *   available to `AgentRunner` implementations via `AgentRunRequest.blackboard`.
 */

export class Blackboard {
  private store: Map<string, Map<string, unknown>>

  constructor() {
    this.store = new Map()
  }

  /** Get or create the namespace for a run. */
  namespace(runId: string): BlackboardNamespace {
    let ns = this.store.get(runId)
    if (!ns) {
      ns = new Map()
      this.store.set(runId, ns)
    }
    return new BlackboardNamespace(ns)
  }

  /** Remove a namespace entirely (cleanup). */
  deleteNamespace(runId: string): boolean {
    return this.store.delete(runId)
  }
}

export class BlackboardNamespace {
  constructor(private data: Map<string, unknown>) {}

  /** Read a value by key. Returns `undefined` if the key does not exist. */
  get<T = unknown>(key: string): T | undefined {
    return this.data.get(key) as T | undefined
  }

  /** Write a value by key. */
  set<T>(key: string, value: T): void {
    this.data.set(key, value)
  }

  /** Delete a key. Returns `true` if the key existed. */
  delete(key: string): boolean {
    return this.data.delete(key)
  }

  /** Check whether a key exists. */
  has(key: string): boolean {
    return this.data.has(key)
  }

  /** Return all keys currently in the namespace. */
  list(): string[] {
    return Array.from(this.data.keys())
  }

  /** Remove all keys from the namespace. */
  clear(): void {
    this.data.clear()
  }

  /**
   * Atomic compare-and-swap.
   *
   * Sets `key` to `value` only if the current value is `===` to `expected`.
   * When `expected` is `undefined`, the CAS succeeds only when the key
   * does **not** exist (create-if-absent semantics).
   *
   * Returns `true` if the swap was performed, `false` otherwise.
   */
  cas<T>(key: string, expected: T | undefined, value: T): boolean {
    const exists = this.data.has(key)
    if (!exists) {
      if (expected !== undefined) return false
    } else {
      const current = this.data.get(key) as T | undefined
      if (current !== expected) return false
    }
    this.data.set(key, value)
    return true
  }
}
