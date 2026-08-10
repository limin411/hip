// packages/sidecar/src/memory/entity-store.test.ts
import { describe, it, expect } from 'vitest'
import { NoopEntityStore } from './entity-store.js'

describe('NoopEntityStore (G8 placeholder)', () => {
  it('add is idempotent and harmless', () => {
    const s = new NoopEntityStore()
    expect(() => s.add('sqlite', 'm1')).not.toThrow()
    expect(() => s.add('sqlite', 'm2')).not.toThrow()
  })

  it('get returns empty and list returns empty', () => {
    const s = new NoopEntityStore()
    expect(s.get('sqlite')).toEqual([])
    expect(s.list()).toEqual([])
  })
})
