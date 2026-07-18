import { describe, it, expect } from 'vitest'
import { splitHighlight } from './highlightSearchText'

describe('splitHighlight', () => {
  it('returns single text part for empty / whitespace query', () => {
    expect(splitHighlight('Hello World', '')).toEqual([{ type: 'text', value: 'Hello World' }])
    expect(splitHighlight('Hello World', '   ')).toEqual([{ type: 'text', value: 'Hello World' }])
  })

  it('returns single text part for empty text', () => {
    expect(splitHighlight('', 'foo')).toEqual([{ type: 'text', value: '' }])
  })

  it('returns single text part when no match', () => {
    expect(splitHighlight('Hello World', 'xyz')).toEqual([{ type: 'text', value: 'Hello World' }])
  })

  it('matches ASCII case-insensitively and preserves original casing', () => {
    expect(splitHighlight('Hello WORLD hello', 'world')).toEqual([
      { type: 'text', value: 'Hello ' },
      { type: 'mark', value: 'WORLD' },
      { type: 'text', value: ' hello' },
    ])
    expect(splitHighlight('Hello World', 'HELLO')).toEqual([
      { type: 'mark', value: 'Hello' },
      { type: 'text', value: ' World' },
    ])
  })

  it('treats metacharacters as literal substrings', () => {
    expect(splitHighlight('Learn C++ today', 'C++')).toEqual([
      { type: 'text', value: 'Learn ' },
      { type: 'mark', value: 'C++' },
      { type: 'text', value: ' today' },
    ])
    expect(splitHighlight('See (draft) notes', '(draft)')).toEqual([
      { type: 'text', value: 'See ' },
      { type: 'mark', value: '(draft)' },
      { type: 'text', value: ' notes' },
    ])
    expect(splitHighlight('file a.b name', 'a.b')).toEqual([
      { type: 'text', value: 'file ' },
      { type: 'mark', value: 'a.b' },
      { type: 'text', value: ' name' },
    ])
  })

  it('matches CJK queries without word boundaries', () => {
    expect(splitHighlight('会话级权限控制', '权限')).toEqual([
      { type: 'text', value: '会话级' },
      { type: 'mark', value: '权限' },
      { type: 'text', value: '控制' },
    ])
  })

  it('finds multiple non-overlapping occurrences left-to-right', () => {
    expect(splitHighlight('foo bar foo baz foo', 'foo')).toEqual([
      { type: 'mark', value: 'foo' },
      { type: 'text', value: ' bar ' },
      { type: 'mark', value: 'foo' },
      { type: 'text', value: ' baz ' },
      { type: 'mark', value: 'foo' },
    ])
  })

  it('handles match at start and end', () => {
    expect(splitHighlight('token rest', 'token')).toEqual([
      { type: 'mark', value: 'token' },
      { type: 'text', value: ' rest' },
    ])
    expect(splitHighlight('rest token', 'token')).toEqual([
      { type: 'text', value: 'rest ' },
      { type: 'mark', value: 'token' },
    ])
    expect(splitHighlight('token', 'token')).toEqual([{ type: 'mark', value: 'token' }])
  })

  it('trims query before matching', () => {
    expect(splitHighlight('alpha beta', '  beta  ')).toEqual([
      { type: 'text', value: 'alpha ' },
      { type: 'mark', value: 'beta' },
    ])
  })
})
