import { describe, it, expect } from 'vitest'
import { collapsePath, relativePathUnderCwd, resolvePathUnderCwd } from './pathScope'

describe('collapsePath', () => {
  it('collapses . and ..', () => {
    expect(collapsePath('/a/b/../c/./d')).toBe('/a/c/d')
    expect(collapsePath('a/../b')).toBe('b')
  })
})

describe('resolvePathUnderCwd', () => {
  it('joins relative paths under cwd', () => {
    expect(resolvePathUnderCwd('/proj', 'src/a.ts')).toBe('/proj/src/a.ts')
  })

  it('accepts absolute paths still under cwd', () => {
    expect(resolvePathUnderCwd('/proj', '/proj/src/a.ts')).toBe('/proj/src/a.ts')
  })

  it('rejects path escape via ..', () => {
    expect(resolvePathUnderCwd('/proj', '../etc/passwd')).toBeNull()
    expect(resolvePathUnderCwd('/proj', '/etc/passwd')).toBeNull()
  })

  it('returns null without cwd', () => {
    expect(resolvePathUnderCwd(null, 'a.ts')).toBeNull()
    expect(resolvePathUnderCwd('', 'a.ts')).toBeNull()
  })
})

describe('relativePathUnderCwd', () => {
  it('strips cwd prefix', () => {
    expect(relativePathUnderCwd('/proj', '/proj/src/a.ts')).toBe('src/a.ts')
    expect(relativePathUnderCwd('/proj', 'src/a.ts')).toBe('src/a.ts')
  })
})
