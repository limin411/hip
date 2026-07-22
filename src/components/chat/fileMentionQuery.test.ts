import { describe, it, expect } from 'vitest'
import {
  extractAtQuery,
  applyFileMention,
  applyFileMentionDirPrefix,
  stripAtToken,
} from './fileMentionQuery'

describe('extractAtQuery', () => {
  it('opens on bare @', () => {
    expect(extractAtQuery('@')).toBe('')
  })

  it('opens after whitespace', () => {
    expect(extractAtQuery('hello @fo')).toBe('fo')
    expect(extractAtQuery('hello\t@x')).toBe('x')
  })

  it('allows path separators inside the token', () => {
    expect(extractAtQuery('@src/a')).toBe('src/a')
    expect(extractAtQuery('@../x')).toBe('../x')
  })

  it('does not open for email / mid-token @', () => {
    expect(extractAtQuery('user@host')).toBeNull()
    expect(extractAtQuery('a@b.com')).toBeNull()
    expect(extractAtQuery('foo/@bar')).toBeNull()
  })

  it('closes after trailing space', () => {
    expect(extractAtQuery('@src/foo ')).toBeNull()
    expect(extractAtQuery('hello @src/foo ')).toBeNull()
  })

  it('returns null when no active token', () => {
    expect(extractAtQuery('')).toBeNull()
    expect(extractAtQuery('hello')).toBeNull()
    expect(extractAtQuery('@done and more')).toBeNull()
  })
})

describe('applyFileMention', () => {
  it('replaces bare token', () => {
    expect(applyFileMention('@fo', 'src/foo.ts')).toBe('@src/foo.ts ')
  })

  it('keeps prefix text', () => {
    expect(applyFileMention('check @src/fo', 'src/foo.ts')).toBe('check @src/foo.ts ')
  })

  it('normalizes backslashes and trailing slashes', () => {
    expect(applyFileMention('@x', 'src\\foo.ts')).toBe('@src/foo.ts ')
    expect(applyFileMention('@x', 'src/foo/')).toBe('@src/foo ')
  })
})

describe('applyFileMentionDirPrefix', () => {
  it('inserts trailing slash and no space so palette stays open', () => {
    expect(applyFileMentionDirPrefix('@sr', 'src')).toBe('@src/')
    expect(extractAtQuery(applyFileMentionDirPrefix('@sr', 'src'))).toBe('src/')
  })

  it('keeps prefix text', () => {
    expect(applyFileMentionDirPrefix('see @s', 'src')).toBe('see @src/')
  })
})

describe('stripAtToken', () => {
  it('strips active token', () => {
    expect(stripAtToken('@fo')).toBe('')
    expect(stripAtToken('hello @fo')).toBe('hello ')
  })

  it('leaves non-token text alone', () => {
    expect(stripAtToken('hello')).toBe('hello')
  })
})
