import { describe, expect, it } from 'vitest'
import {
  findEmbedRangesInText,
  findWikiRangesInText,
  formatWikiToken,
} from './wikiPm'

describe('wikiPm', () => {
  it('finds simple wiki', () => {
    const r = findWikiRangesInText('See [[Alpha]] please', 10)
    expect(r).toHaveLength(1)
    expect(r[0].title).toBe('Alpha')
    expect(r[0].from).toBe(14)
    expect(r[0].to).toBe(23)
  })

  it('finds alias', () => {
    const r = findWikiRangesInText('[[Alpha|Shown]]', 0)
    expect(r[0].title).toBe('Alpha')
    expect(r[0].display).toBe('Shown')
  })

  it('skips embeds for wiki finder', () => {
    const r = findWikiRangesInText('x ![[Alpha]] y [[Beta]]', 0)
    expect(r).toHaveLength(1)
    expect(r[0].title).toBe('Beta')
  })

  it('finds embeds', () => {
    const r = findEmbedRangesInText('intro\n![[Note]]\nout', 0)
    expect(r).toHaveLength(1)
    expect(r[0].title).toBe('Note')
  })

  it('formatWikiToken', () => {
    expect(formatWikiToken('A')).toBe('[[A]]')
    expect(formatWikiToken('A', 'B')).toBe('[[A|B]]')
  })

  it('CJK', () => {
    const r = findWikiRangesInText('链接[[中文标题]]', 0)
    expect(r[0].title).toBe('中文标题')
  })
})
