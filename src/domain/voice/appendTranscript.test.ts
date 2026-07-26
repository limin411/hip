// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { appendTranscript } from './appendTranscript'

describe('appendTranscript', () => {
  it('returns text when prev empty', () => {
    expect(appendTranscript('', ' hi ')).toBe('hi')
  })
  it('adds space when needed', () => {
    expect(appendTranscript('Hello', 'world')).toBe('Hello world')
  })
  it('does not double space', () => {
    expect(appendTranscript('Hello ', 'world')).toBe('Hello world')
  })
  it('ignores empty transcript', () => {
    expect(appendTranscript('x', '  ')).toBe('x')
  })
})
