import { describe, expect, it } from 'vitest'
import {
  BLOCK_SLASH_IDS,
  KNOWLEDGE_SLASH_ITEMS,
  TABLE_SKELETON_3X2,
  applySlashInsertText,
  extractSlashQueryAt,
  filterSlashItems,
  filterSlashItemsForLive,
  liveAllowsBlockSlash,
  prepareSlashInsert,
  sameSlashMatch,
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
      'embed',
      'callout',
      'math',
      'mermaid',
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

    it('prefix-matches name (h → h1,h2,h3,hr)', () => {
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

  describe('sameSlashMatch', () => {
    it('compares by fields', () => {
      expect(sameSlashMatch(null, null)).toBe(true)
      expect(sameSlashMatch({ query: 'a', from: 0, to: 2 }, null)).toBe(false)
      expect(
        sameSlashMatch(
          { query: 'a', from: 0, to: 2 },
          { query: 'a', from: 0, to: 2 },
        ),
      ).toBe(true)
      expect(
        sameSlashMatch(
          { query: 'a', from: 0, to: 2 },
          { query: 'b', from: 0, to: 2 },
        ),
      ).toBe(false)
    })
  })

  describe('liveAllowsBlockSlash / filterSlashItemsForLive', () => {
    it('allows block slash at textblock start', () => {
      expect(liveAllowsBlockSlash('/table', 0)).toBe(true)
      expect(liveAllowsBlockSlash('/', 0)).toBe(true)
    })

    it('allows block slash when only whitespace precedes /', () => {
      expect(liveAllowsBlockSlash('  /h1', 2)).toBe(true)
      expect(liveAllowsBlockSlash('\t/mer', 1)).toBe(true)
    })

    it('rejects block slash mid-line after non-whitespace', () => {
      expect(liveAllowsBlockSlash('para /table', 5)).toBe(false)
      expect(liveAllowsBlockSlash('x /', 2)).toBe(false)
    })

    it('rejects out-of-range slash offsets', () => {
      expect(liveAllowsBlockSlash('a', -1)).toBe(false)
      expect(liveAllowsBlockSlash('a', 2)).toBe(false)
    })

    it('filterSlashItemsForLive keeps all items when allowBlocks', () => {
      const out = filterSlashItemsForLive(KNOWLEDGE_SLASH_ITEMS, {
        allowBlocks: true,
      })
      expect(out).toEqual(KNOWLEDGE_SLASH_ITEMS)
    })

    it('filterSlashItemsForLive drops BLOCK_SLASH_IDS when !allowBlocks', () => {
      const out = filterSlashItemsForLive(KNOWLEDGE_SLASH_ITEMS, {
        allowBlocks: false,
      })
      expect(out.every((i) => !BLOCK_SLASH_IDS.has(i.id))).toBe(true)
      expect(out.map((i) => i.id)).toEqual(['wiki', 'embed'])
    })

    it('chains after filterSlashItems for mid-line Live', () => {
      const q = filterSlashItems(KNOWLEDGE_SLASH_ITEMS, 'w')
      const mid = filterSlashItemsForLive(q, { allowBlocks: false })
      expect(mid.map((i) => i.id)).toEqual(['wiki'])
    })
  })

  describe('prepareSlashInsert / applySlashInsertText (M3)', () => {
    it('line-start h1 leaves snippet as-is', () => {
      const h1 = KNOWLEDGE_SLASH_ITEMS.find((i) => i.id === 'h1')!
      const prepared = prepareSlashInsert('/h1', 0, h1)
      expect(prepared.insert).toBe('# ')
      expect(prepared.cursorOffset).toBe(2)
      const result = applySlashInsertText('/h1', 0, 3, h1)
      expect(result.text).toBe('# ')
      expect(result.cursor).toBe(2)
    })

    it('mid-line block h1 prepends newline', () => {
      const h1 = KNOWLEDGE_SLASH_ITEMS.find((i) => i.id === 'h1')!
      const doc = 'para /h1'
      const from = 5
      const to = 8
      const result = applySlashInsertText(doc, from, to, h1)
      expect(result.text).toBe('para \n# ')
      expect(result.cursor).toBe(from + 1 + h1.cursorOffset)
    })

    it('mid-line hr becomes thematic break on new line', () => {
      const hr = KNOWLEDGE_SLASH_ITEMS.find((i) => i.id === 'hr')!
      const result = applySlashInsertText('para /hr', 5, 8, hr)
      expect(result.text).toBe('para \n---\n')
    })

    it('mid-line table starts on new line', () => {
      const table = KNOWLEDGE_SLASH_ITEMS.find((i) => i.id === 'table')!
      const result = applySlashInsertText('x /table', 2, 8, table)
      expect(result.text.startsWith('x \n|   |   |   |')).toBe(true)
    })

    it('wiki stays inline mid-line', () => {
      const wiki = KNOWLEDGE_SLASH_ITEMS.find((i) => i.id === 'wiki')!
      const result = applySlashInsertText('see /wiki', 4, 9, wiki)
      expect(result.text).toBe('see [[]]')
      expect(result.cursor).toBe(4 + 2)
    })

    it('preserves surrounding text for task at line start', () => {
      const task = KNOWLEDGE_SLASH_ITEMS.find((i) => i.id === 'task')!
      const doc = 'note\n/task more'
      // /task starts at index 5
      const from = 5
      const to = 10
      const result = applySlashInsertText(doc, from, to, task)
      expect(result.text).toBe('note\n- [ ]  more')
    })

    it('inserts wiki link skeleton with cursor inside brackets', () => {
      const wiki = KNOWLEDGE_SLASH_ITEMS.find((i) => i.id === 'wiki')!
      const result = applySlashInsertText('/', 0, 1, wiki)
      expect(result.text).toBe('[[]]')
      expect(result.cursor).toBe(2)
    })
  })
})
