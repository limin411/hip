import { describe, it, expect } from 'vitest'
import { parseRichLine } from './adapters.js'

describe('parseRichLine', () => {
  it('parses text / reasoning / tool / done events', () => {
    expect(parseRichLine('{"type":"text","delta":"hi"}')).toEqual({ kind: 'text', delta: 'hi' })
    expect(parseRichLine('{"type":"reasoning","delta":"mm"}')).toEqual({ kind: 'reasoning', delta: 'mm' })
    expect(parseRichLine('{"type":"tool_start","id":"t1","name":"edit","input":{"a":1}}')).toEqual({ kind: 'tool_start', id: 't1', name: 'edit', input: { a: 1 } })
    expect(parseRichLine('{"type":"tool_end","id":"t1","output":"done","ok":true}')).toEqual({ kind: 'tool_end', id: 't1', output: 'done', ok: true })
    expect(parseRichLine('{"type":"done"}')).toEqual({ kind: 'done' })
  })
  it('returns null for malformed JSON or unknown types (tolerate noise)', () => {
    expect(parseRichLine('not json')).toBeNull()
    expect(parseRichLine('{"type":"chatter"}')).toBeNull()
    expect(parseRichLine('{"type":"text"}')).toBeNull()
  })
})
