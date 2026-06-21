import { describe, it, expect } from 'vitest'
import {
  SystemContext,
  SystemContextRegistry,
} from './system-context.js'
import type {
  Codec,
  JsonValue,
  Source,
  Snapshot,
  Unavailable,
} from './system-context.js'

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * A mutable string-valued source for tests. The holder exposes `setValue` and
 * `setUnavailable` so tests can simulate source changes between reconcile calls.
 */
interface MutableStringSource {
  readonly source: Source<string>
  setValue(v: string): void
  setUnavailable(reason: string): void
}

function makeStringSource(key: string, initial: string): MutableStringSource {
  let current: string | Unavailable = initial
  const codec: Codec<string> = {
    encode: (a: string): JsonValue => a,
    decode: (j: JsonValue): string => (typeof j === 'string' ? j : ''),
  }
  return {
    source: {
      key,
      codec,
      load: async () => current,
      baseline: (v: string) => `${key} = ${v}`,
      update: (prev: string, curr: string) => `${key}: ${prev} -> ${curr}`,
    },
    setValue: (v: string) => {
      current = v
    },
    setUnavailable: (reason: string) => {
      current = { _tag: 'Unavailable', reason }
    },
  }
}

/** A source whose load() always throws — used to verify error containment. */
function makeThrowingSource(key: string): Source<string> {
  return {
    key,
    codec: {
      encode: (a: string): JsonValue => a,
      decode: (j: JsonValue): string => (typeof j === 'string' ? j : ''),
    },
    load: async () => {
      throw new Error(`boom in ${key}`)
    },
    baseline: (v: string) => `${key} = ${v}`,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SystemContext.initialize', () => {
  // ── Test 1: initialize with 3 sources → baseline joined with "\n\n" ─────────
  it('joins 3 source baselines with double newlines in deterministic key order', async () => {
    const a = makeStringSource('core/alpha', 'A1')
    const b = makeStringSource('core/beta', 'B1')
    const c = makeStringSource('core/gamma', 'C1')
    const ctx = new SystemContext([c.source, a.source, b.source]) // intentionally unsorted

    const gen = await ctx.initialize()

    // Deterministic order is alphabetical by key: alpha, beta, gamma
    expect(gen.baseline).toBe('core/alpha = A1\n\ncore/beta = B1\n\ncore/gamma = C1')
    expect(Object.keys(gen.snapshot)).toEqual(['core/alpha', 'core/beta', 'core/gamma'])
    expect(gen.snapshot['core/alpha']).toEqual({ value: 'A1' })
    expect(gen.snapshot['core/beta']).toEqual({ value: 'B1' })
    expect(gen.snapshot['core/gamma']).toEqual({ value: 'C1' })
  })

  // ── Test 8 (moved here — load lifecycle): load() throws → treated as Unavailable
  it('treats a thrown load() as Unavailable, not a crash', async () => {
    const good = makeStringSource('core/good', 'OK')
    const bad = makeThrowingSource('core/bad')
    const ctx = new SystemContext([good.source, bad])

    const gen = await ctx.initialize()

    // The throwing source is simply absent from the result — no crash, no throw.
    expect(gen.baseline).toBe('core/good = OK')
    expect(gen.snapshot['core/good']).toEqual({ value: 'OK' })
    expect(gen.snapshot['core/bad']).toBeUndefined()
  })
})

describe('SystemContext.reconcile', () => {
  // ── Test 2: reconcile with unchanged snapshot → Unchanged ───────────────────
  it('returns Unchanged when no source values differ from the snapshot', async () => {
    const a = makeStringSource('core/a', 'A1')
    const b = makeStringSource('core/b', 'B1')
    const ctx = new SystemContext([a.source, b.source])
    const { snapshot } = await ctx.initialize()

    const result = await ctx.reconcile(snapshot)

    expect(result).toEqual({ _tag: 'Unchanged' })
  })

  // ── Test 3: reconcile with 1 changed source → Updated with diff text ────────
  it('returns Updated with source.update() diff when one value changes', async () => {
    const a = makeStringSource('core/a', 'A1')
    const b = makeStringSource('core/b', 'B1')
    const ctx = new SystemContext([a.source, b.source])
    const { snapshot } = await ctx.initialize()

    // Mutate source A after initialize
    a.setValue('A2')

    const result = await ctx.reconcile(snapshot)

    expect(result).toEqual({ _tag: 'Updated', messages: ['core/a: A1 -> A2'] })
  })

  it('returns Updated with baseline text when a changed source has no update()', async () => {
    // Source without update() — should fall back to baseline(curr)
    const holder = makeStringSource('core/no-update', 'X1')
    const src: Source<string> = {
      key: holder.source.key,
      codec: holder.source.codec,
      load: holder.source.load,
      baseline: holder.source.baseline,
      // intentionally no update()
    }
    const ctx = new SystemContext([src])
    const { snapshot } = await ctx.initialize()

    holder.setValue('X2')
    const result = await ctx.reconcile(snapshot)

    expect(result).toEqual({ _tag: 'Updated', messages: ['core/no-update = X2'] })
  })

  it('returns Updated when a brand-new source appears that was not in the snapshot', async () => {
    const a = makeStringSource('core/a', 'A1')
    const ctx = new SystemContext([a.source])
    const { snapshot } = await ctx.initialize()

    // Register a second source after initialize — the old snapshot only has core/a
    const b = makeStringSource('core/b', 'B1')
    const ctx2 = new SystemContext([a.source, b.source])

    const result = await ctx2.reconcile(snapshot)

    expect(result).toEqual({ _tag: 'Updated', messages: ['core/b = B1'] })
  })

  // ── Test 4: reconcile with unavailable source → Replace ─────────────────────
  it('returns Replace when a previously-available source becomes Unavailable', async () => {
    const a = makeStringSource('core/a', 'A1')
    const b = makeStringSource('core/b', 'B1')
    const ctx = new SystemContext([a.source, b.source])
    const { snapshot } = await ctx.initialize()

    // Source B goes away
    b.setUnavailable('file deleted')

    const result = await ctx.reconcile(snapshot)

    expect(result).toEqual({ _tag: 'Replace' })
  })

  it('returns Replace when the snapshot references a source no longer registered', async () => {
    const a = makeStringSource('core/a', 'A1')
    const b = makeStringSource('core/b', 'B1')
    const ctx = new SystemContext([a.source, b.source])
    const { snapshot } = await ctx.initialize()

    // New context without source B
    const ctx2 = new SystemContext([a.source])
    const result = await ctx2.reconcile(snapshot)

    expect(result).toEqual({ _tag: 'Replace' })
  })
})

describe('SystemContext.replace', () => {
  // ── Test 5: replace with all available → ReplacementReady ───────────────────
  it('returns ReplacementReady with a fresh generation when all sources load', async () => {
    const a = makeStringSource('core/a', 'A1')
    const b = makeStringSource('core/b', 'B1')
    const ctx = new SystemContext([a.source, b.source])
    const { snapshot } = await ctx.initialize()

    // Both sources change
    a.setValue('A2')
    b.setValue('B2')

    const result = await ctx.replace(snapshot)

    expect(result._tag).toBe('ReplacementReady')
    if (result._tag !== 'ReplacementReady') return

    expect(result.generation.baseline).toBe('core/a = A2\n\ncore/b = B2')
    expect(result.generation.snapshot['core/a']).toEqual({ value: 'A2' })
    expect(result.generation.snapshot['core/b']).toEqual({ value: 'B2' })
  })

  // ── Test 6: replace with 1 unavailable → ReplacementBlocked ─────────────────
  it('returns ReplacementBlocked when any source is Unavailable', async () => {
    const a = makeStringSource('core/a', 'A1')
    const b = makeStringSource('core/b', 'B1')
    const ctx = new SystemContext([a.source, b.source])
    const { snapshot } = await ctx.initialize()

    b.setUnavailable('permission denied')

    const result = await ctx.replace(snapshot)

    expect(result._tag).toBe('ReplacementBlocked')
    if (result._tag !== 'ReplacementBlocked') return
    expect(result.reason).toContain('core/b')
    expect(result.reason).toContain('permission denied')
  })
})

// ── Test 7: snapshot roundtrips through JSON.stringify/parse ──────────────────
describe('snapshot JSON roundtrip', () => {
  it('survives JSON.stringify → JSON.parse without loss', async () => {
    const a = makeStringSource('core/a', 'A1')
    const ctx = new SystemContext([a.source])
    const gen = await ctx.initialize()

    // Simulate persistence: serialize the snapshot, then parse it back
    const serialized = JSON.stringify(gen.snapshot)
    const roundtripped: Snapshot = JSON.parse(serialized)

    const result = await ctx.reconcile(roundtripped)

    // Same value, same structure → no change detected
    expect(result).toEqual({ _tag: 'Unchanged' })
    expect(roundtripped).toEqual(gen.snapshot)
  })
})

// ── SystemContextRegistry ─────────────────────────────────────────────────────
describe('SystemContextRegistry', () => {
  it('register/unregister/sources in deterministic key order', () => {
    const reg = new SystemContextRegistry()
    const a = makeStringSource('core/alpha', 'A')
    const b = makeStringSource('core/beta', 'B')
    const c = makeStringSource('core/gamma', 'C')

    // Register out of order
    reg.register(c.source)
    reg.register(a.source)
    reg.register(b.source)

    const sources = reg.sources()
    expect(sources.map((s) => s.key)).toEqual(['core/alpha', 'core/beta', 'core/gamma'])

    reg.unregister('core/beta')
    expect(reg.sources().map((s) => s.key)).toEqual(['core/alpha', 'core/gamma'])
  })

  it('throws on duplicate registration of the same key', () => {
    const reg = new SystemContextRegistry()
    const a = makeStringSource('core/a', 'A1')

    reg.register(a.source)
    expect(() => reg.register(makeStringSource('core/a', 'A2').source)).toThrow(
      'Duplicate source key: core/a',
    )
  })

  it('unregister of an unknown key is a no-op', () => {
    const reg = new SystemContextRegistry()
    expect(() => reg.unregister('nope')).not.toThrow()
    expect(reg.sources()).toHaveLength(0)
  })

  it('feeds directly into SystemContext constructor', async () => {
    const reg = new SystemContextRegistry()
    reg.register(makeStringSource('core/a', 'A1').source)
    reg.register(makeStringSource('core/b', 'B1').source)

    const ctx = new SystemContext(reg.sources())
    const gen = await ctx.initialize()

    expect(gen.baseline).toBe('core/a = A1\n\ncore/b = B1')
  })
})
