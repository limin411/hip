import { describe, it, expect } from 'vitest'
import { modelBadges } from './modelBadges'
import type { CatalogModel } from '@/ipc/catalog'

const base: CatalogModel = { id: 'm', name: 'M' }

describe('modelBadges', () => {
  it('rounds the context window to thousands', () => {
    expect(modelBadges({ ...base, limit: { context: 128000, output: 4096 } }).contextK).toBe(128)
    expect(modelBadges({ ...base, limit: { context: 63500, output: 8192 } }).contextK).toBe(64)
  })

  it('returns null context when the model has no limit', () => {
    expect(modelBadges(base).contextK).toBeNull()
  })

  it('lists capabilities in reasoning → tool → attachment order regardless of input order', () => {
    const m: CatalogModel = { ...base, attachment: true, reasoning: true, tool_call: true }
    expect(modelBadges(m).caps).toEqual(['reasoning', 'tool_call', 'attachment'])
  })

  it('omits absent capabilities', () => {
    expect(modelBadges({ ...base, tool_call: true }).caps).toEqual(['tool_call'])
    expect(modelBadges(base).caps).toEqual([])
  })
})
