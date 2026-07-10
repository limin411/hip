import { describe, it, expect } from 'vitest'
import {
  sigOf,
  trailingRepeatCount,
  DOOM_LOOP_N,
  pathHitKey,
  countPathHits,
  normalizeToolPath,
  trailingErrorStreak,
  PATH_HIT_LIMIT,
} from './doom-loop.js'

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

  it('pathHitKey normalizes slashes and only applies to path tools', () => {
    expect(pathHitKey('read_file', { path: '/proj//a' })).toBe('read_file:/proj/a')
    expect(pathHitKey('ls', { path: 'foo\\bar' })).toBe('ls:foo/bar')
    expect(pathHitKey('glob', { pattern: '**/*.ts' })).toBe('glob:**/*.ts')
    expect(pathHitKey('write_file', { path: '/x' })).toBeNull()
    expect(normalizeToolPath('/a//b/')).toBe('/a/b')
  })

  it('countPathHits counts occurrences of a key', () => {
    const hits = ['read_file:/a', 'ls:/b', 'read_file:/a']
    expect(countPathHits(hits, 'read_file:/a')).toBe(2)
    expect(PATH_HIT_LIMIT).toBe(3)
  })

  it('trailingErrorStreak counts only consecutive Error* tails', () => {
    expect(trailingErrorStreak(['ok', 'Error: a', 'Error: b'])).toBe(2)
    expect(trailingErrorStreak(['Error: a', 'ok', 'Error: b'])).toBe(1)
    expect(trailingErrorStreak(['Error: a', 'Error: b', 'Error: c'])).toBe(3)
  })
})
