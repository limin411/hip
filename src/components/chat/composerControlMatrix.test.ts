import { describe, it, expect } from 'vitest'
import {
  resolveComposerControls,
  assertDisjointControls,
  type ComposerControlFlags,
  type ControlId,
} from './composerControlMatrix'

function base(over: Partial<ComposerControlFlags> = {}): ComposerControlFlags {
  return {
    surface: 'code',
    externalPrimary: false,
    permissionMode: 'edit',
    forcePlan: false,
    effortIsDefault: true,
    hasEffortLevels: true,
    sessionBound: true,
    ...over,
  }
}

function expectDisjoint(flags: ComposerControlFlags) {
  const r = resolveComposerControls(flags)
  expect(assertDisjointControls(r)).toBe(true)
  const all = [...r.primary, ...r.pinned, ...r.overflow]
  expect(new Set(all).size).toBe(all.length)
  return r
}

describe('resolveComposerControls', () => {
  it('code default: primary agent/model/branch/attach; effort+permission+plan+guidance in overflow', () => {
    const r = expectDisjoint(base())
    expect(r.primary).toEqual(['agent', 'model', 'branch', 'attach'])
    expect(r.pinned).toEqual([])
    expect(r.overflow).toEqual(['effort', 'permission', 'plan', 'guidance'])
  })

  it('code pins permission when mode is not edit', () => {
    const r = expectDisjoint(base({ permissionMode: 'full' }))
    expect(r.pinned).toContain('permission')
    expect(r.overflow).not.toContain('permission')
    expect(r.overflow).toEqual(['effort', 'plan', 'guidance'])
  })

  it('code pins plan when forcePlan', () => {
    const r = expectDisjoint(base({ forcePlan: true }))
    expect(r.pinned).toContain('plan')
    expect(r.overflow).not.toContain('plan')
  })

  it('code pins effort when non-default', () => {
    const r = expectDisjoint(base({ effortIsDefault: false }))
    expect(r.pinned).toContain('effort')
    expect(r.overflow).not.toContain('effort')
  })

  it('hides effort entirely when hasEffortLevels is false', () => {
    const r = expectDisjoint(base({ hasEffortLevels: false, effortIsDefault: false }))
    expect(r.pinned).not.toContain('effort')
    expect(r.overflow).not.toContain('effort')
  })

  it('chat: primary agent/model/attach; only effort in overflow', () => {
    const r = expectDisjoint(
      base({
        surface: 'chat',
        hasEffortLevels: true,
        sessionBound: true,
      }),
    )
    expect(r.primary).toEqual(['agent', 'model', 'attach'])
    expect(r.pinned).toEqual([])
    expect(r.overflow).toEqual(['effort'])
  })

  it('chat pins effort when non-default', () => {
    const r = expectDisjoint(
      base({
        surface: 'chat',
        effortIsDefault: false,
        hasEffortLevels: true,
      }),
    )
    expect(r.pinned).toEqual(['effort'])
    expect(r.overflow).toEqual([])
  })

  it('code external primary: no model/effort/plan; agent+branch+attach primary', () => {
    const r = expectDisjoint(
      base({
        externalPrimary: true,
        forcePlan: true,
        effortIsDefault: false,
        hasEffortLevels: true,
      }),
    )
    expect(r.primary).toEqual(['agent', 'branch', 'attach'])
    expect(r.pinned).toEqual([])
    expect(r.overflow).toEqual(['permission', 'guidance'])
    expect(r.overflow).not.toContain('effort')
    expect(r.overflow).not.toContain('plan')
  })

  it('NewConversation code (sessionBound false): no guidance/branch', () => {
    const r = expectDisjoint(base({ sessionBound: false }))
    expect(r.primary).toEqual(['agent', 'model', 'attach'])
    expect(r.overflow).toEqual(['effort', 'permission', 'plan'])
    expect(r.overflow).not.toContain('guidance')
    expect(r.overflow).not.toContain('branch')
  })

  it('available.guidance false removes guidance from overflow', () => {
    const r = expectDisjoint(
      base({
        available: { guidance: false },
      }),
    )
    expect(r.overflow).not.toContain('guidance')
  })

  it('every ControlId appears at most once across buckets', () => {
    const combos: ComposerControlFlags[] = [
      base(),
      base({ permissionMode: 'chat', forcePlan: true, effortIsDefault: false }),
      base({ surface: 'chat', effortIsDefault: false }),
      base({ externalPrimary: true, permissionMode: 'full' }),
      base({ sessionBound: false, forcePlan: true }),
    ]
    for (const flags of combos) {
      expectDisjoint(flags)
    }
  })

  it('no overflow when all secondaries pinned or unavailable', () => {
    const r = expectDisjoint(
      base({
        surface: 'chat',
        effortIsDefault: false,
        hasEffortLevels: true,
      }),
    )
    expect(r.overflow).toEqual([])
  })
})

describe('assertDisjointControls', () => {
  it('detects overlap', () => {
    expect(
      assertDisjointControls({
        primary: ['agent'],
        pinned: ['agent'] as ControlId[],
        overflow: [],
      }),
    ).toBe(false)
  })
})
