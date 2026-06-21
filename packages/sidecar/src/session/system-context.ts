// ── SystemContext: typed, refreshable context providers ───────────────────────
//
// Port of the OpenCode V2 SystemContext pattern to plain TypeScript (no Effect.ts).
// Each Source<A> is an independently refreshable typed context provider with
// initialize / reconcile / replace lifecycle:
//
//   initialize  — first load of all sources; produces a baseline + snapshot
//   reconcile   — compare current sources to a prior snapshot; patch or replace
//   replace     — full rebuild; either a fresh generation or a blocked outcome
//
// The snapshot is JSON-serializable so it can be persisted across runs and
// compared structurally. Sources are loaded in parallel via Promise.all since
// they are lightweight (in-memory or local file reads).

// ── JSON value type ───────────────────────────────────────────────────────────

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue }

// ── Source value outcomes ─────────────────────────────────────────────────────

/** A source that could not be loaded. Carries a human-readable reason. */
export interface Unavailable {
  readonly _tag: 'Unavailable'
  readonly reason: string
}

/** Codec: the boundary parser that serializes a source value to/from JSON. */
export interface Codec<A> {
  encode(a: A): JsonValue
  decode(j: JsonValue): A
}

/**
 * A typed, independently refreshable context provider.
 *
 * - `key`      stable identifier (e.g. "core/environment"); unique within a registry.
 * - `codec`    boundary parser — serializes A to JSON and back.
 * - `load`     reads the current value; may return Unavailable or throw.
 * - `baseline` renders the model-visible text for the value.
 * - `update`   optional diff text when the value changes between snapshots.
 * - `removed`  optional message emitted when the source leaves the registry.
 */
export interface Source<A> {
  readonly key: string
  readonly codec: Codec<A>
  load(): Promise<A | Unavailable>
  baseline(current: A): string
  update?(prev: A, curr: A): string
  removed?(prev: A): string
}

// ── Snapshot & Generation ─────────────────────────────────────────────────────

/** A single source's last-known serialized state inside a snapshot. */
export interface SnapshotEntry {
  readonly value: JsonValue
  readonly removed?: string
}

/** Persisted state of every source at a point in time. JSON-serializable. */
export type Snapshot = Record<string, SnapshotEntry>

/** The full baseline text + the snapshot it was derived from. */
export interface Generation {
  readonly baseline: string
  readonly snapshot: Snapshot
}

// ── Lifecycle outcomes ────────────────────────────────────────────────────────

export type ReconcileResult =
  | { readonly _tag: 'Unchanged' }
  | { readonly _tag: 'Updated'; readonly messages: readonly string[] }
  | { readonly _tag: 'Replace' }

export type ReplaceResult =
  | { readonly _tag: 'ReplacementReady'; readonly generation: Generation }
  | { readonly _tag: 'ReplacementBlocked'; readonly reason: string }

// ── Internal load result (discriminated union for clean narrowing) ────────────

type LoadResult =
  | { readonly _tag: 'Available'; readonly value: unknown }
  | { readonly _tag: 'Unavailable'; readonly reason: string }

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Runtime guard: does this loaded value carry the Unavailable marker? */
function isUnavailable(value: unknown): value is Unavailable {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_tag' in value &&
    value._tag === 'Unavailable'
  )
}

/** Load a source, converting thrown errors to Unavailable rather than crashing. */
async function safeLoad(source: Source<unknown>): Promise<LoadResult> {
  try {
    const result = await source.load()
    if (isUnavailable(result)) {
      return { _tag: 'Unavailable', reason: result.reason }
    }
    return { _tag: 'Available', value: result }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { _tag: 'Unavailable', reason }
  }
}

/** Structural JSON equality — codec output is assumed canonical. */
function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Deterministic key sort: localeCompare on the source key string. */
function byKey(a: Source<unknown>, b: Source<unknown>): number {
  return a.key.localeCompare(b.key)
}

// ── SystemContext ─────────────────────────────────────────────────────────────

/**
 * Combines multiple typed sources into a single model-visible baseline with a
 * reconcile / replace lifecycle.
 */
export class SystemContext {
  private readonly sources: readonly Source<unknown>[]

  constructor(sources: readonly Source<unknown>[]) {
    // Deterministic order by key — results are stable across runs regardless
    // of the registration order the caller used.
    this.sources = [...sources].sort(byKey)
  }

  /**
   * First load of every source. Available sources contribute to the baseline
   * (joined with "\n\n") and the snapshot; unavailable ones are simply skipped.
   */
  async initialize(): Promise<Generation> {
    const loaded = await Promise.all(
      this.sources.map(async (src) => ({ source: src, result: await safeLoad(src) })),
    )

    const baselineParts: string[] = []
    const snapshot: Snapshot = {}

    for (const { source, result } of loaded) {
      if (result._tag === 'Unavailable') continue
      snapshot[source.key] = { value: source.codec.encode(result.value) }
      baselineParts.push(source.baseline(result.value))
    }

    return { baseline: baselineParts.join('\n\n'), snapshot }
  }

  /**
   * Compare current source values to a prior snapshot.
   *
   * - Unchanged: every source value matches the snapshot.
   * - Updated:   one or more sources changed (or appeared); carries diff text.
   * - Replace:   a source went away or was removed from the registry — caller
   *              must do a full `replace` to rebuild the baseline.
   */
  async reconcile(snapshot: Snapshot): Promise<ReconcileResult> {
    // If the snapshot references sources no longer registered, the baseline
    // structure fundamentally changed — caller must replace.
    const registered = new Set(this.sources.map((s) => s.key))
    for (const key of Object.keys(snapshot)) {
      if (!registered.has(key)) {
        return { _tag: 'Replace' }
      }
    }

    const loaded = await Promise.all(
      this.sources.map(async (src) => ({ source: src, result: await safeLoad(src) })),
    )

    const messages: string[] = []

    for (const { source, result } of loaded) {
      const prev = snapshot[source.key]

      if (result._tag === 'Unavailable') {
        // A source that was previously available is now gone → structure changed.
        if (prev !== undefined) {
          return { _tag: 'Replace' }
        }
        // Wasn't available before either — no change to report.
        continue
      }

      const encoded = source.codec.encode(result.value)

      if (prev === undefined) {
        // Brand-new source appeared since the last snapshot.
        messages.push(source.baseline(result.value))
        continue
      }

      if (!jsonEqual(encoded, prev.value)) {
        const prevValue = source.codec.decode(prev.value)
        const diff =
          source.update !== undefined
            ? source.update(prevValue, result.value)
            : source.baseline(result.value)
        messages.push(diff)
      }
    }

    if (messages.length === 0) {
      return { _tag: 'Unchanged' }
    }
    return { _tag: 'Updated', messages }
  }

  /**
   * Full rebuild. All registered sources MUST load successfully — if any are
   * Unavailable, the replacement is blocked and the caller keeps the old
   * baseline. On success a fresh Generation is returned.
   */
  async replace(_snapshot: Snapshot): Promise<ReplaceResult> {
    const loaded = await Promise.all(
      this.sources.map(async (src) => ({ source: src, result: await safeLoad(src) })),
    )

    const blocked = loaded.find((l) => l.result._tag === 'Unavailable')
    if (blocked !== undefined && blocked.result._tag === 'Unavailable') {
      return {
        _tag: 'ReplacementBlocked',
        reason: `Source "${blocked.source.key}" unavailable: ${blocked.result.reason}`,
      }
    }

    const baselineParts: string[] = []
    const snapshot: Snapshot = {}

    for (const { source, result } of loaded) {
      if (result._tag !== 'Available') continue // unreachable — guarded above
      snapshot[source.key] = { value: source.codec.encode(result.value) }
      baselineParts.push(source.baseline(result.value))
    }

    return {
      _tag: 'ReplacementReady',
      generation: { baseline: baselineParts.join('\n\n'), snapshot },
    }
  }
}

// ── SystemContextRegistry ─────────────────────────────────────────────────────

/**
 * Keyed registry of sources. `sources()` returns a deterministic
 * key-sorted array suitable for feeding directly into SystemContext.
 */
export class SystemContextRegistry {
  private readonly map = new Map<string, Source<unknown>>()

  register(source: Source<unknown>): void {
    if (this.map.has(source.key)) {
      throw new Error(`Duplicate source key: ${source.key}`)
    }
    this.map.set(source.key, source)
  }

  unregister(key: string): void {
    this.map.delete(key)
  }

  sources(): Source<unknown>[] {
    return [...this.map.values()].sort(byKey)
  }
}
