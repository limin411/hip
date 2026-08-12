import { describe, expect, it } from 'vitest'
import { chunkStreamText } from './streamChunks'

describe('chunkStreamText', () => {
  it('returns [] for empty / whitespace-only input', () => {
    expect(chunkStreamText('')).toEqual([])
    expect(chunkStreamText('   ')).toEqual([])
  })

  it('chunks latin text at ~3 words and never drops characters', () => {
    const text = 'one two three four five six seven'
    const chunks = chunkStreamText(text)
    expect(chunks.join('')).toBe(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toBe('one two three ')
  })

  it('chunks CJK runs at 6 chars and never drops characters', () => {
    const text = '已定位误报根因，需要修复依赖图越界访问'
    const chunks = chunkStreamText(text)
    expect(chunks.join('')).toBe(text)
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(6)
    }
  })

  it('keeps a short single token as one chunk', () => {
    expect(chunkStreamText('hello')).toEqual(['hello'])
    expect(chunkStreamText('修复')).toEqual(['修复'])
  })

  it('handles mixed latin + CJK text without losing content', () => {
    const text = '读取 src/domain/sessionStore 的依赖图，修复误报。'
    const chunks = chunkStreamText(text)
    expect(chunks.join('')).toBe(text)
  })

  it('preserves trailing spaces inside chunks but not at the end', () => {
    const chunks = chunkStreamText('a b c d')
    expect(chunks.join('')).toBe('a b c d')
    expect(chunks[chunks.length - 1]).toBe('d')
  })
})
