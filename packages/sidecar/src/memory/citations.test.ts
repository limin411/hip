import { describe, it, expect, beforeEach } from 'vitest'
import type { MemoryItem } from '@hip/protocol'
import { openDatabase } from '../persistence/open.js'
import { MemoryStore } from './store.js'
import { parseMemoryCitations, bumpMemoryUseCounts } from './citations.js'

function item(partial: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'title' | 'content'>): MemoryItem {
  return {
    scope: 'project',
    kind: 'preference',
    confidence: 0.8,
    status: 'active',
    source: 'user',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    useCount: 0,
    pinned: false,
    projectKeyHash: 'pkh1',
    ...partial,
  }
}

describe('parseMemoryCitations', () => {
  it('parses trailing fence and strips it from content', () => {
    const content = [
      'Based on prior prefs, use yarn.',
      '',
      '```hip-memory-citations',
      '[{"memoryId":"m1","title":"Prefer yarn","note":"package manager"}]',
      '```',
    ].join('\n')
    const { citations, strippedContent } = parseMemoryCitations(content)
    expect(citations).toEqual([
      { memoryId: 'm1', title: 'Prefer yarn', note: 'package manager' },
    ])
    expect(strippedContent).toBe('Based on prior prefs, use yarn.')
    expect(strippedContent).not.toContain('hip-memory-citations')
  })

  it('ignores invalid fence JSON and leaves content unchanged', () => {
    const content = [
      'Hello',
      '```hip-memory-citations',
      'not-json',
      '```',
    ].join('\n')
    const { citations, strippedContent } = parseMemoryCitations(content)
    expect(citations).toEqual([])
    expect(strippedContent).toBe(content)
  })

  it('ignores fence that is not trailing', () => {
    const content = [
      '```hip-memory-citations',
      '[{"memoryId":"m1"}]',
      '```',
      '',
      'more text after',
    ].join('\n')
    const { citations, strippedContent } = parseMemoryCitations(content)
    expect(citations).toEqual([])
    expect(strippedContent).toBe(content)
  })

  it('collects inline [mem:id] only when allowedIds contains the id', () => {
    const content = 'See [mem:a1] and [mem:b2] and [mem:unknown].'
    const { citations, strippedContent } = parseMemoryCitations(
      content,
      new Set(['a1', 'b2']),
    )
    expect(citations).toEqual([{ memoryId: 'a1' }, { memoryId: 'b2' }])
    // Inline markers are kept in content.
    expect(strippedContent).toBe(content)
  })

  it('does not collect inline markers without allowedIds', () => {
    const content = 'See [mem:a1].'
    const { citations, strippedContent } = parseMemoryCitations(content)
    expect(citations).toEqual([])
    expect(strippedContent).toBe(content)
  })

  it('merges fence + allowed inline without duplicating ids', () => {
    const content = [
      'Used [mem:m1] and [mem:m2].',
      '```hip-memory-citations',
      '[{"memoryId":"m1","title":"From fence"}]',
      '```',
    ].join('\n')
    const { citations, strippedContent } = parseMemoryCitations(
      content,
      new Set(['m1', 'm2']),
    )
    expect(citations).toEqual([
      { memoryId: 'm1', title: 'From fence' },
      { memoryId: 'm2' },
    ])
    expect(strippedContent).toBe('Used [mem:m1] and [mem:m2].')
  })
})

describe('bumpMemoryUseCounts', () => {
  let store: MemoryStore

  beforeEach(() => {
    const { db, memoriesFtsEnabled } = openDatabase(':memory:')
    store = new MemoryStore(db, memoriesFtsEnabled)
    store.upsertItem(item({ id: 'm1', title: 't', content: 'c' }))
    store.upsertItem(item({ id: 'm2', title: 't2', content: 'c2' }))
  })

  it('increments use_count once per unique id', () => {
    bumpMemoryUseCounts(store, ['m1', 'm1', 'm2'])
    expect(store.getItem('m1')!.useCount).toBe(1)
    expect(store.getItem('m2')!.useCount).toBe(1)
    expect(store.getItem('m1')!.lastUsedAt).toBeTypeOf('number')
  })
})
