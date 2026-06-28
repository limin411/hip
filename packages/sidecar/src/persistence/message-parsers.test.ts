import { describe, it, expect } from 'vitest'
import {
  EventPayloadError,
  reqString,
  optString,
  optNumber,
  optStringArray,
  optObjectArray,
  parseUsage,
} from './message-parsers.js'

describe('message-parsers: reqString', () => {
  it('returns the string value when present and non-empty', () => {
    expect(reqString({ foo: 'bar' }, 'event', 'foo')).toBe('bar')
  })

  it('throws EventPayloadError when field is missing', () => {
    expect(() => reqString({}, 'event', 'foo')).toThrow(EventPayloadError)
    expect(() => reqString({}, 'event', 'foo')).toThrow(/foo/)
  })

  it('throws EventPayloadError when field is empty string', () => {
    expect(() => reqString({ foo: '' }, 'event', 'foo')).toThrow(EventPayloadError)
  })

  it('throws EventPayloadError when field is not a string', () => {
    expect(() => reqString({ foo: 123 }, 'event', 'foo')).toThrow(EventPayloadError)
    expect(() => reqString({ foo: null }, 'event', 'foo')).toThrow(EventPayloadError)
    expect(() => reqString({ foo: undefined }, 'event', 'foo')).toThrow(EventPayloadError)
  })
})

describe('message-parsers: optString', () => {
  it('returns string value when present', () => {
    expect(optString({ foo: 'bar' }, 'foo')).toBe('bar')
  })

  it('returns null when absent', () => {
    expect(optString({}, 'foo')).toBeNull()
  })

  it('returns null when not a string', () => {
    expect(optString({ foo: 123 }, 'foo')).toBeNull()
    expect(optString({ foo: null }, 'foo')).toBeNull()
  })
})

describe('message-parsers: optNumber', () => {
  it('returns finite number when present', () => {
    expect(optNumber({ foo: 42 }, 'foo')).toBe(42)
    expect(optNumber({ foo: 0 }, 'foo')).toBe(0)
  })

  it('returns null when absent', () => {
    expect(optNumber({}, 'foo')).toBeNull()
  })

  it('returns null for non-finite numbers', () => {
    expect(optNumber({ foo: NaN }, 'foo')).toBeNull()
    expect(optNumber({ foo: Infinity }, 'foo')).toBeNull()
    expect(optNumber({ foo: -Infinity }, 'foo')).toBeNull()
  })

  it('returns null for non-number values', () => {
    expect(optNumber({ foo: '42' }, 'foo')).toBeNull()
    expect(optNumber({ foo: null }, 'foo')).toBeNull()
  })
})

describe('message-parsers: optStringArray', () => {
  it('returns array of strings when present', () => {
    expect(optStringArray({ foo: ['a', 'b'] }, 'foo')).toEqual(['a', 'b'])
  })

  it('filters out non-string entries', () => {
    expect(optStringArray({ foo: ['a', 1, 'b', null] }, 'foo')).toEqual(['a', 'b'])
  })

  it('returns empty array when absent', () => {
    expect(optStringArray({}, 'foo')).toEqual([])
  })

  it('returns empty array when not an array', () => {
    expect(optStringArray({ foo: 'not-array' }, 'foo')).toEqual([])
    expect(optStringArray({ foo: null }, 'foo')).toEqual([])
  })
})

describe('message-parsers: parseUsage', () => {
  it('returns usage object when all fields are finite numbers', () => {
    expect(parseUsage({ usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    })
  })

  it('returns null when usage is absent', () => {
    expect(parseUsage({})).toBeNull()
  })

  it('returns null when usage is not an object', () => {
    expect(parseUsage({ usage: 'x' })).toBeNull()
    expect(parseUsage({ usage: null })).toBeNull()
  })

  it('returns null when any token field is missing or invalid', () => {
    expect(parseUsage({ usage: { inputTokens: 10, outputTokens: 5 } })).toBeNull()
    expect(parseUsage({ usage: { inputTokens: 10, outputTokens: 5, totalTokens: NaN } })).toBeNull()
    expect(parseUsage({ usage: { inputTokens: '10', outputTokens: 5, totalTokens: 15 } })).toBeNull()
  })
})

describe('message-parsers: optObjectArray', () => {
  it('returns objects when no guard is provided', () => {
    expect(optObjectArray({ foo: [{ a: 1 }, { b: 2 }] }, 'foo')).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('filters out non-objects', () => {
    expect(optObjectArray({ foo: [{ a: 1 }, 'x', null, 42] }, 'foo')).toEqual([{ a: 1 }])
  })

  it('returns undefined when field is absent or not an array', () => {
    expect(optObjectArray({}, 'foo')).toBeUndefined()
    expect(optObjectArray({ foo: 'not-array' }, 'foo')).toBeUndefined()
  })

  it('applies guard to filter objects', () => {
    interface Item { id: string }
    const guard = (x: Record<string, unknown>): x is Record<string, unknown> & Item => typeof x.id === 'string'
    expect(optObjectArray<Item>({ foo: [{ id: 'a' }, { id: 1 }, { name: 'b' }] }, 'foo', guard)).toEqual([{ id: 'a' }])
  })
})
