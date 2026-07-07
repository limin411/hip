import { describe, it, expect } from 'vitest'
import { Blackboard, BlackboardNamespace } from './blackboard.js'

// ---------------------------------------------------------------------------
// BlackboardNamespace unit tests
// ---------------------------------------------------------------------------

describe('BlackboardNamespace', () => {
  it('set / get within the same namespace', () => {
    const ns = new Blackboard().namespace('test')
    ns.set('color', 'blue')
    ns.set('count', 42)
    ns.set('nested', { a: 1 })

    expect(ns.get('color')).toBe('blue')
    expect(ns.get<number>('count')).toBe(42)
    expect(ns.get<{ a: number }>('nested')).toEqual({ a: 1 })
  })

  it('returns undefined for missing keys', () => {
    const ns = new Blackboard().namespace('test')
    expect(ns.get('nonexistent')).toBeUndefined()
  })

  it('has returns true/false correctly', () => {
    const ns = new Blackboard().namespace('test')
    ns.set('key1', 1)
    expect(ns.has('key1')).toBe(true)
    expect(ns.has('key2')).toBe(false)
  })

  it('delete removes a key and returns true if it existed', () => {
    const ns = new Blackboard().namespace('test')
    ns.set('tmp', 'value')
    expect(ns.delete('tmp')).toBe(true)
    expect(ns.has('tmp')).toBe(false)
    expect(ns.delete('tmp')).toBe(false)
  })

  it('list returns all keys', () => {
    const ns = new Blackboard().namespace('test')
    ns.set('a', 1)
    ns.set('b', 2)
    ns.set('c', 3)
    const keys = ns.list()
    expect(keys).toHaveLength(3)
    expect(keys).toEqual(expect.arrayContaining(['a', 'b', 'c']))
  })

  it('list returns empty array for empty namespace', () => {
    const ns = new Blackboard().namespace('test')
    expect(ns.list()).toEqual([])
  })

  it('clear empties all keys', () => {
    const ns = new Blackboard().namespace('test')
    ns.set('a', 1)
    ns.set('b', 2)
    ns.clear()
    expect(ns.list()).toEqual([])
    expect(ns.has('a')).toBe(false)
  })

  // ---- CAS ----

  it('CAS succeeds when expected matches current value', () => {
    const ns = new Blackboard().namespace('test')
    ns.set('x', 10)
    const result = ns.cas('x', 10, 20)
    expect(result).toBe(true)
    expect(ns.get('x')).toBe(20)
  })

  it('CAS fails when expected does not match current value', () => {
    const ns = new Blackboard().namespace('test')
    ns.set('x', 10)
    const result = ns.cas('x', 99, 20)
    expect(result).toBe(false)
    expect(ns.get('x')).toBe(10) // unchanged
  })

  it('CAS succeeds with undefined expected on a missing key (create-if-absent)', () => {
    const ns = new Blackboard().namespace('test')
    const result = ns.cas('new-key', undefined, 'initial')
    expect(result).toBe(true)
    expect(ns.get('new-key')).toBe('initial')
  })

  it('CAS fails when expected is undefined but key exists', () => {
    const ns = new Blackboard().namespace('test')
    ns.set('existing', 1)
    const result = ns.cas<number>('existing', undefined, 99)
    expect(result).toBe(false)
    expect(ns.get('existing')).toBe(1) // unchanged
  })

  it('CAS with object reference equality', () => {
    const ref = { deep: true }
    const ns = new Blackboard().namespace('test')
    ns.set('obj', ref)

    // Same reference => success
    expect(ns.cas('obj', ref, { replaced: true } as any)).toBe(true)
    expect(ns.get('obj')).toEqual({ replaced: true })

    // Different reference (even if deeply equal) => failure
    ns.set('obj2', { a: 1 })
    expect(ns.cas('obj2', { a: 1 }, { b: 2 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Blackboard integration tests
// ---------------------------------------------------------------------------

describe('Blackboard (namespace isolation)', () => {
  it('two runs have isolated namespaces', () => {
    const bb = new Blackboard()
    const runA = bb.namespace('run-a')
    const runB = bb.namespace('run-b')

    runA.set('key', 'value-a')
    runB.set('key', 'value-b')

    expect(runA.get('key')).toBe('value-a')
    expect(runB.get('key')).toBe('value-b')
  })

  it('namespace returns the same instance for the same runId', () => {
    const bb = new Blackboard()
    const ns1 = bb.namespace('same-run')
    const ns2 = bb.namespace('same-run')

    ns1.set('shared', 1)
    expect(ns2.get('shared')).toBe(1)
  })

  it('deleteNamespace removes the namespace entirely', () => {
    const bb = new Blackboard()
    const ns = bb.namespace('ephemeral')
    ns.set('k', 'v')
    expect(ns.has('k')).toBe(true)

    bb.deleteNamespace('ephemeral')
    // Getting a new namespace for the same runId starts fresh
    const nsAfter = bb.namespace('ephemeral')
    expect(nsAfter.has('k')).toBe(false)
  })

  it('deleteNamespace returns false for non-existent namespace', () => {
    const bb = new Blackboard()
    expect(bb.deleteNamespace('never-existed')).toBe(false)
  })
})
