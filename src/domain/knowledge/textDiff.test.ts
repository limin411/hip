import { describe, expect, it } from 'vitest'
import { diffLines } from './textDiff'

describe('diffLines', () => {
  it('detects adds and deletes', () => {
    const lines = diffLines('a\nb\nc\n', 'a\nx\nc\n')
    const types = lines.map((l) => l.type)
    expect(types).toContain('del')
    expect(types).toContain('add')
    expect(lines.some((l) => l.type === 'same' && l.text === 'a')).toBe(true)
  })

  it('identical texts are all same', () => {
    const lines = diffLines('hello\n', 'hello\n')
    expect(lines.every((l) => l.type === 'same')).toBe(true)
  })
})
