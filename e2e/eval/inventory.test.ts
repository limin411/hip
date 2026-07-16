import { describe, expect, it } from 'vitest'
import { inventoryDelta } from './inventory.js'
import type { ChangeInventory } from './types.js'

function inv(partial: Partial<ChangeInventory>): ChangeInventory {
  return {
    dirtyAfter: false,
    paths: [],
    fullPatch: '',
    trackedPatch: '',
    ...partial,
  }
}

describe('inventoryDelta', () => {
  it('ignores no-op when baseline and after match', () => {
    const base = inv({
      dirtyAfter: true,
      paths: ['backend/common/util.go'],
      fullPatch: 'diff A',
    })
    const after = inv({
      dirtyAfter: true,
      paths: ['backend/common/util.go'],
      fullPatch: 'diff A',
    })
    const d = inventoryDelta(base, after)
    expect(d.paths).toEqual([])
    expect(d.agentTouched).toBe(false)
    expect(d.dirtyAfter).toBe(true)
  })

  it('detects agent rewrite of same fixture path', () => {
    const base = inv({
      dirtyAfter: true,
      paths: ['backend/common/util.go'],
      fullPatch: 'diff broken',
    })
    const after = inv({
      dirtyAfter: true,
      paths: ['backend/common/util.go'],
      fullPatch: 'diff fixed',
    })
    const d = inventoryDelta(base, after)
    expect(d.paths).toContain('backend/common/util.go')
    expect(d.agentTouched).toBe(true)
  })

  it('detects restore-to-clean (fixture fixed back to HEAD)', () => {
    const base = inv({
      dirtyAfter: true,
      paths: ['backend/common/util.go'],
      fullPatch: 'diff broken',
    })
    const after = inv({
      dirtyAfter: false,
      paths: [],
      fullPatch: '',
    })
    const d = inventoryDelta(base, after)
    expect(d.paths).toContain('backend/common/util.go')
    expect(d.agentTouched).toBe(true)
    expect(d.dirtyAfter).toBe(false)
  })

  it('detects new paths', () => {
    const base = inv({ dirtyAfter: false, paths: [] })
    const after = inv({ dirtyAfter: true, paths: ['foo.go'], fullPatch: 'x' })
    expect(inventoryDelta(base, after).paths).toEqual(['foo.go'])
    expect(inventoryDelta(base, after).agentTouched).toBe(true)
  })

  it('ignores .hip/ and Users/ noise paths for agentTouched', () => {
    const base = inv({ dirtyAfter: false, paths: [] })
    const after = inv({
      dirtyAfter: true,
      paths: ['.hip/plans/x.json', 'Users/me/.hip/plans/y.md'],
      fullPatch: 'noise',
    })
    const d = inventoryDelta(base, after)
    expect(d.paths).toEqual([])
    expect(d.agentTouched).toBe(false)
  })
})
