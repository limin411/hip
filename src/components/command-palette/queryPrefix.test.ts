import { describe, it, expect } from 'vitest'
import { filterGroupsByMode, parsePaletteQuery } from './queryPrefix'

describe('parsePaletteQuery', () => {
  it('parses > commands prefix', () => {
    expect(parsePaletteQuery('> settings')).toEqual({
      mode: 'commands',
      needle: 'settings',
      prefix: '>',
      raw: '> settings',
    })
  })

  it('parses # sessions prefix', () => {
    expect(parsePaletteQuery('#foo')).toMatchObject({
      mode: 'sessions',
      needle: 'foo',
      prefix: '#',
    })
  })

  it('parses @ skills prefix', () => {
    expect(parsePaletteQuery('@pdf')).toMatchObject({
      mode: 'skills',
      needle: 'pdf',
      prefix: '@',
    })
  })

  it('defaults to all without prefix', () => {
    expect(parsePaletteQuery('theme')).toMatchObject({
      mode: 'all',
      needle: 'theme',
      prefix: null,
    })
  })
})

describe('filterGroupsByMode', () => {
  const groups = [
    { id: 'navigation', items: [1] },
    { id: 'sessions', items: [2] },
    { id: 'skills', items: [3] },
  ]

  it('keeps all in all mode', () => {
    expect(filterGroupsByMode(groups, 'all')).toHaveLength(3)
  })

  it('sessions mode only sessions', () => {
    expect(filterGroupsByMode(groups, 'sessions').map((g) => g.id)).toEqual(['sessions'])
  })

  it('skills mode only skills', () => {
    expect(filterGroupsByMode(groups, 'skills').map((g) => g.id)).toEqual(['skills'])
  })

  it('commands mode drops sessions and skills', () => {
    expect(filterGroupsByMode(groups, 'commands').map((g) => g.id)).toEqual(['navigation'])
  })
})
