import { describe, it, expect } from 'vitest'
import { tokenize } from './stream'

describe('tokenize', () => {
  it('splits text into chunks of given size', () => {
    expect(tokenize('abcd', 2)).toEqual(['ab', 'cd'])
  })

  it('keeps remainder in a final shorter chunk', () => {
    expect(tokenize('abcde', 2)).toEqual(['ab', 'cd', 'e'])
  })

  it('rejoins to the original text', () => {
    const text = 'hello world 你好'
    expect(tokenize(text, 3).join('')).toBe(text)
  })

  it('returns empty array for empty string', () => {
    expect(tokenize('', 2)).toEqual([])
  })
})
