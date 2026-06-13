import { describe, it, expect } from 'vitest'
import { sigOf, trailingRepeatCount, DOOM_LOOP_N } from './doom-loop.js'

describe('doom-loop signatures', () => {
  it('identical calls produce identical signatures', () => {
    const a = sigOf([{ name: 'read_file', args: { path: '/a.txt' } }])
    const b = sigOf([{ name: 'read_file', args: { path: '/a.txt' } }])
    expect(a).toBe(b)
  })

  it('different args produce different signatures', () => {
    const a = sigOf([{ name: 'read_file', args: { path: '/a.txt' } }])
    const b = sigOf([{ name: 'read_file', args: { path: '/b.txt' } }])
    expect(a).not.toBe(b)
  })

  it('trailingRepeatCount counts only the consecutive tail run', () => {
    const s = sigOf([{ name: 'ls', args: { path: '/' } }])
    const other = sigOf([{ name: 'ls', args: { path: '/sub' } }])
    expect(trailingRepeatCount([s, s, s], s)).toBe(3)
    expect(trailingRepeatCount([s, other, s, s], s)).toBe(2)
    expect(trailingRepeatCount([s, s, other], s)).toBe(0)
  })

  it('the threshold constant is 3', () => {
    expect(DOOM_LOOP_N).toBe(3)
  })
})
