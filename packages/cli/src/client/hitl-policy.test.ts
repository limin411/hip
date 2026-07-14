import { describe, it, expect } from 'vitest'
import {
  pickAllowOptionId,
  decidePermissionHitl,
  decideInterruptHitl,
  parseInterruptContextKind,
} from './hitl-policy.js'

describe('pickAllowOptionId', () => {
  it('prefers kind starting with allow', () => {
    expect(
      pickAllowOptionId([
        { optionId: 'no', name: 'No', kind: 'reject_once' },
        { optionId: 'once', name: 'Yes', kind: 'allow_once' },
      ]),
    ).toBe('once')
  })

  it('falls back to known allow optionIds', () => {
    expect(
      pickAllowOptionId([{ optionId: 'once', name: 'Yes', kind: 'other' }]),
    ).toBe('once')
  })

  it('returns null when nothing allow-like', () => {
    expect(pickAllowOptionId([{ optionId: 'no', name: 'No', kind: 'reject_once' }])).toBeNull()
  })
})

describe('decidePermissionHitl', () => {
  it('fail → hitl_blocked', () => {
    const d = decidePermissionHitl('fail', [{ optionId: 'allow_once', name: 'A', kind: 'allow_once' }], true)
    expect(d.action).toBe('block')
    expect(d.status).toBe('hitl_blocked')
  })

  it('auto allows allow_once', () => {
    const d = decidePermissionHitl('auto', [{ optionId: 'allow_once', name: 'A', kind: 'allow_once' }], false)
    expect(d.action).toBe('allow')
    expect(d.optionId).toBe('allow_once')
  })
})

describe('decideInterruptHitl', () => {
  it('auto plan_approval allows when under max', () => {
    const d = decideInterruptHitl('auto', 'plan_approval', 0, 1, false)
    expect(d.action).toBe('allow')
  })

  it('auto plan_approval exhausts → awaiting_user', () => {
    const d = decideInterruptHitl('auto', 'plan_approval', 1, 1, false)
    expect(d.action).toBe('block')
    expect(d.status).toBe('awaiting_user')
  })

  it('auto doom → awaiting_user', () => {
    const d = decideInterruptHitl('auto', 'doom_loop', 0, 1, false)
    expect(d.status).toBe('awaiting_user')
  })

  it('fail plan → hitl_blocked', () => {
    const d = decideInterruptHitl('fail', 'plan_approval', 0, 1, false)
    expect(d.status).toBe('hitl_blocked')
  })
})

describe('parseInterruptContextKind', () => {
  it('parses kind', () => {
    expect(parseInterruptContextKind(JSON.stringify({ kind: 'plan_approval' }))).toBe('plan_approval')
  })
})
