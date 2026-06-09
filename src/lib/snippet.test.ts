import { describe, it, expect } from 'vitest'
import { splitSnippet } from './snippet'

const S = '\u0001' // match start sentinel
const E = '\u0002' // match end sentinel

describe('splitSnippet', () => {
  it('no markers → a single unmarked segment', () => {
    expect(splitSnippet('plain title')).toEqual([{ text: 'plain title', mark: false }])
  })

  it('one match in the middle → text / mark / text', () => {
    expect(splitSnippet(`before ${S}match${E} after`)).toEqual([
      { text: 'before ', mark: false },
      { text: 'match', mark: true },
      { text: ' after', mark: false },
    ])
  })

  it('multiple matches', () => {
    expect(splitSnippet(`${S}a${E} mid ${S}b${E}`)).toEqual([
      { text: 'a', mark: true },
      { text: ' mid ', mark: false },
      { text: 'b', mark: true },
    ])
  })

  it('leading and trailing match (no surrounding plain text)', () => {
    expect(splitSnippet(`${S}only${E}`)).toEqual([{ text: 'only', mark: true }])
  })

  it('empty string → no segments', () => {
    expect(splitSnippet('')).toEqual([])
  })

  it('drops empty segments between adjacent markers', () => {
    expect(splitSnippet(`${S}b${E}${S}c${E}`)).toEqual([
      { text: 'b', mark: true },
      { text: 'c', mark: true },
    ])
  })

  it('a lone end-sentinel with no start is treated as plain text', () => {
    expect(splitSnippet(`${E}plain`)).toEqual([{ text: `${E}plain`, mark: false }])
  })
})
