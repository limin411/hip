import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { jsonSchemaToZod, type JsonSchema } from './json-schema-to-zod.js'

describe('jsonSchemaToZod', () => {
  it('an empty / non-object schema becomes an open object', () => {
    const shape = jsonSchemaToZod(undefined)
    expect(shape).toBeInstanceOf(z.ZodObject)
    expect(shape.safeParse({ anything: 1 }).success).toBe(true)
  })

  it('required string + optional number', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { weightKg: { type: 'number' }, unit: { type: 'string' } },
      required: ['weightKg'],
    }
    const z0 = jsonSchemaToZod(schema)
    expect(z0.safeParse({ weightKg: 70 }).success).toBe(true)          // optional unit omitted
    expect(z0.safeParse({ weightKg: 70, unit: 'kg' }).success).toBe(true)
    expect(z0.safeParse({ unit: 'kg' }).success).toBe(false)            // missing required weightKg
    expect(z0.safeParse({ weightKg: 'heavy' }).success).toBe(false)     // wrong type
  })

  it('integer maps to z.number().int()', () => {
    const z0 = jsonSchemaToZod({ type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] })
    expect(z0.safeParse({ n: 3 }).success).toBe(true)
    expect(z0.safeParse({ n: 3.5 }).success).toBe(false)
  })

  it('boolean and array of strings', () => {
    const z0 = jsonSchemaToZod({
      type: 'object',
      properties: { flag: { type: 'boolean' }, tags: { type: 'array', items: { type: 'string' } } },
      required: ['flag', 'tags'],
    })
    expect(z0.safeParse({ flag: true, tags: ['a', 'b'] }).success).toBe(true)
    expect(z0.safeParse({ flag: true, tags: [1] }).success).toBe(false)
  })

  it('enum string', () => {
    const z0 = jsonSchemaToZod({ type: 'object', properties: { color: { type: 'string', enum: ['red', 'green'] } }, required: ['color'] })
    expect(z0.safeParse({ color: 'red' }).success).toBe(true)
    expect(z0.safeParse({ color: 'blue' }).success).toBe(false)
  })

  it('nested object', () => {
    const z0 = jsonSchemaToZod({
      type: 'object',
      properties: { who: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
      required: ['who'],
    })
    expect(z0.safeParse({ who: { name: 'x' } }).success).toBe(true)
    expect(z0.safeParse({ who: {} }).success).toBe(false)
  })

  it('unknown leaf type degrades to z.any (still accepts)', () => {
    const z0 = jsonSchemaToZod({ type: 'object', properties: { weird: { type: 'null' } }, required: ['weird'] })
    expect(z0.safeParse({ weird: null }).success).toBe(true)
    expect(z0.safeParse({ weird: 'whatever' }).success).toBe(true)
  })
})
