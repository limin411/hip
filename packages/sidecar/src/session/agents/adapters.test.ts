import { describe, it, expect } from 'vitest'
import { buildModelEnv, parseRichLine } from './adapters.js'

describe('buildModelEnv', () => {
  it('maps a resolved model to the HIP_* env contract', () => {
    expect(buildModelEnv({ providerID: 'acme', modelID: 'acme-large', baseURL: 'https://acme.test/v1', apiKey: 'sk' }))
      .toEqual({ HIP_PROVIDER: 'acme', HIP_MODEL: 'acme-large', HIP_BASE_URL: 'https://acme.test/v1', HIP_API_KEY: 'sk' })
  })
  it('omits HIP_API_KEY when there is no key', () => {
    expect(buildModelEnv({ providerID: 'acme', modelID: 'm', baseURL: 'u' })).toEqual({ HIP_PROVIDER: 'acme', HIP_MODEL: 'm', HIP_BASE_URL: 'u' })
  })
})

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
