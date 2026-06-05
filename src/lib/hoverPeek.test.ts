import { describe, it, expect } from 'vitest'
import { peekReducer, initialPeekState, type PeekState } from './hoverPeek'

describe('peekReducer', () => {
  it('starts closed', () => {
    expect(initialPeekState).toEqual({ open: false, pendingClose: false, locked: false })
  })

  it('opens on enter', () => {
    expect(peekReducer(initialPeekState, { type: 'enter' })).toEqual({
      open: true, pendingClose: false, locked: false,
    })
  })

  it('schedules a close on leave while open', () => {
    const open: PeekState = { open: true, pendingClose: false, locked: false }
    expect(peekReducer(open, { type: 'leave' })).toEqual({
      open: true, pendingClose: true, locked: false,
    })
  })

  it('ignores leave when already closed', () => {
    expect(peekReducer(initialPeekState, { type: 'leave' })).toEqual(initialPeekState)
  })

  it('re-entering cancels a pending close', () => {
    const pending: PeekState = { open: true, pendingClose: true, locked: false }
    expect(peekReducer(pending, { type: 'enter' })).toEqual({
      open: true, pendingClose: false, locked: false,
    })
  })

  it('closes when the grace timer elapses', () => {
    const pending: PeekState = { open: true, pendingClose: true, locked: false }
    expect(peekReducer(pending, { type: 'closeElapsed' })).toEqual({
      open: false, pendingClose: false, locked: false,
    })
  })

  it('stays open on leave while locked', () => {
    const locked: PeekState = { open: true, pendingClose: false, locked: true }
    expect(peekReducer(locked, { type: 'leave' })).toEqual(locked)
  })

  it('ignores an elapsed close while locked', () => {
    const locked: PeekState = { open: true, pendingClose: true, locked: true }
    expect(peekReducer(locked, { type: 'closeElapsed' })).toEqual({
      open: true, pendingClose: false, locked: true,
    })
  })

  it('lock forces open and clears any pending close', () => {
    const pending: PeekState = { open: true, pendingClose: true, locked: false }
    expect(peekReducer(pending, { type: 'lock' })).toEqual({
      open: true, pendingClose: false, locked: true,
    })
  })

  it('unlock releases the hold without closing', () => {
    const locked: PeekState = { open: true, pendingClose: false, locked: true }
    expect(peekReducer(locked, { type: 'unlock' })).toEqual({
      open: true, pendingClose: false, locked: false,
    })
  })

  it('reset returns to the initial closed state', () => {
    const locked: PeekState = { open: true, pendingClose: true, locked: true }
    expect(peekReducer(locked, { type: 'reset' })).toEqual(initialPeekState)
  })
})
