import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_SLASH_ITEMS,
  TABLE_SKELETON_3X2,
  applySlashInsertText,
  extractSlashQueryAt,
  filterSlashItems,
  slashItemLabelKey,
} from './slashMenu'

describe('slashMenu', () => {
  it('exposes required insert kinds (P1.2)', () => {
    const ids = KNOWLEDGE_SLASH_ITEMS.map((i) => i.id)
    expect(ids).toEqual([
      'h1',
      'h2',
      'h3',
      'bullet',
      'ordered',
      'task',
      'fence',
      'quote',
      'hr',
      'table',
      'wiki',
    ])
  })

  it('table skeleton is 3 columns × header + 2 body rows', () => {
    const lines = TABLE_SKELETON_3X2.trimEnd().split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe('|   |   |   |')
    expect(lines[1]).toBe('| --- | --- | --- |')
    expect(lines[2]).toBe('|   |   |   |')
    expect(lines[3]).toBe('|   |   |   |')
  })

  it('slashItemLabelKey nests under knowledge.slash', () => {
    expect(slashItemLabelKey('h1')).toBe('knowledge.slash.h1')
    expect(slashItemLabelKey('table')).toBe('knowledge.slash.table')
  })

  describe('extractSlashQueryAt', () => {
    it('matches / at line start', () => {
      expect(extractSlashQueryAt('/h', 2, 10)).toEqual({
        query: 'h',
        from: 10,
        to: 12,
      })
    })

    it('matches empty query right after /', () => {
      expect(extractSlashQueryAt('/', 1, 0)).toEqual({
        query: '',
        from: 0,
        to: 1,
      })
    })

    it('matches / after whitespace', () => {
      expect(extractSlashQueryAt('text /ta', 8, 5)).toEqual({
        query: 'ta',
        from: 5 + 5, // lineFrom 5 + index of /
        to: 5 + 8,
      })
    })

    it('returns null mid-word path-like token', () => {
      expect(extractSlashQueryAt('foo/bar', 7, 0)).toBeNull()
      expect(extractSlashQueryAt('check /tmp/file', 15, 0)).toBeNull()
    })

    it('returns null when cursor is not at end of slash token', () => {
      // cursor in middle of "hello" — no trailing slash query
      expect(extractSlashQueryAt('hello', 3, 0)).toBeNull()
    })

    it('returns null when cursor before any slash', () => {
      expect(extractSlashQueryAt('/h1', 0, 0)).toBeNull()
    })
  })

  describe('filterSlashItems', () => {
    it('returns all items for empty query', () => {
      expect(filterSlashItems(KNOWLEDGE_SLASH_ITEMS, '')).toHaveLength(
        KNOWLEDGE_SLASH_ITEMS.length,
      )
    })

    it('prefix-matches name (h → h1,h2,h3)', () => {
      const names = filterSlashItems(KNOWLEDGE_SLASH_ITEMS, 'h').map((i) => i.name)
      expect(names).toEqual(['h1', 'h2', 'h3', 'hr'])
    })

    it('matches keywords (todo → task)', () => {
      const names = filterSlashItems(KNOWLEDGE_SLASH_ITEMS, 'todo').map((i) => i.name)
      expect(names).toEqual(['task'])
    })

    it('matches exact name first', () => {
      const names = filterSlashItems(KNOWLEDGE_SLASH_ITEMS, 'table').map((i) => i.name)
      expect(names[0]).toBe('table')
    })
  })

  describe('applySlashInsertText', () => {
    it('replaces /query with heading snippet and sets cursor', () => {
      const h1 = KNOWLEDGE_SLASH_ITEMS.find((i) => i.id === 'h1')!
      const result = applySlashInsertText('/h1', 0, 3, h1)
      expect(result.text).toBe('# ')
      expect(result.cursor).toBe(2)
    })

    it('preserves surrounding text', () => {
      const task = KNOWLEDGE_SLASH_ITEMS.find((i) => i.id === 'task')!
      // "note /task more" — replace from index of / to end of token
      const doc = 'note /task more'
      const from = 5
      const to = 10
      const result = applySlashInsertText(doc, from, to, task)
      expect(result.text).toBe('note - [ ]  more')
      expect(result.cursor).toBe(from + task.cursorOffset)
    })

    it('inserts wiki link skeleton with cursor inside brackets', () => {
      const wiki = KNOWLEDGE_SLASH_ITEMS.find((i) => i.id === 'wiki')!
      const result = applySlashInsertText('/', 0, 1, wiki)
      expect(result.text).toBe('[[]]')
      expect(result.cursor).toBe(2)
    })
  })
})
