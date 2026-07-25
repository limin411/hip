import { describe, it, expect } from 'vitest'
import { delimiterForPath, parseDelimited } from './parseDelimited'

describe('delimiterForPath', () => {
  it('uses tab for tsv/tab', () => {
    expect(delimiterForPath('/a/data.tsv')).toBe('\t')
    expect(delimiterForPath('/a/data.tab')).toBe('\t')
  })
  it('uses comma for csv and others', () => {
    expect(delimiterForPath('/a/data.csv')).toBe(',')
    expect(delimiterForPath('/a/data.txt')).toBe(',')
  })
})

describe('parseDelimited', () => {
  it('parses simple csv', () => {
    expect(parseDelimited('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('handles quoted commas and escaped quotes', () => {
    expect(parseDelimited('name,note\n"Ada,Lovelace","said ""hi"""\n')).toEqual([
      ['name', 'note'],
      ['Ada,Lovelace', 'said "hi"'],
    ])
  })

  it('parses tsv with tabs', () => {
    expect(parseDelimited('a\tb\n1\t2', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('handles crlf', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('returns empty for empty input', () => {
    expect(parseDelimited('')).toEqual([])
  })

  it('keeps a blank data row that is not only trailing newline', () => {
    // middle blank line becomes [''] between two data rows
    expect(parseDelimited('a,b\n\nc,d\n')).toEqual([
      ['a', 'b'],
      [''],
      ['c', 'd'],
    ])
  })
})
