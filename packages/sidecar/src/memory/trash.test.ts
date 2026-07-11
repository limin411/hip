import { describe, it, expect, beforeEach } from 'vitest'
import type { MemoryFileConfig, MemoryItem } from '@hip/protocol'
import { MEMORY_FILE_CONFIG_DEFAULTS } from '@hip/protocol'
import { openDatabase } from '../persistence/open.js'
import { MemoryStore } from './store.js'
import { runTrashRetentionJob } from './trash.js'

function cfg(partial: Partial<MemoryFileConfig> = {}): MemoryFileConfig {
  return { ...MEMORY_FILE_CONFIG_DEFAULTS, ...partial }
}

function item(
  partial: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'title' | 'content'>,
): MemoryItem {
  return {
    scope: 'global',
    kind: 'preference',
    confidence: 0.8,
    status: 'deleted',
    source: 'user',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    useCount: 0,
    pinned: false,
    ...partial,
  }
}

const DAY = 24 * 60 * 60 * 1000

describe('runTrashRetentionJob', () => {
  let store: MemoryStore

  beforeEach(() => {
    const { db, memoriesFtsEnabled } = openDatabase(':memory:')
    store = new MemoryStore(db, memoriesFtsEnabled)
  })

  it('purges deleted items older than trashRetentionDays (default 30)', () => {
    const now = Date.UTC(2026, 0, 31)
    store.upsertItem(item({
      id: 'old',
      title: 'old trash',
      content: 'c',
      updatedAt: now - 31 * DAY,
    }))
    store.upsertItem(item({
      id: 'recent',
      title: 'recent trash',
      content: 'c',
      updatedAt: now - 10 * DAY,
    }))
    store.upsertItem(item({
      id: 'active',
      title: 'active',
      content: 'c',
      status: 'active',
      updatedAt: now - 100 * DAY,
    }))

    const purged = runTrashRetentionJob(store, cfg(), now)
    expect(purged).toBe(1)
    expect(store.getItem('old')).toBeUndefined()
    expect(store.getItem('recent')?.status).toBe('deleted')
    expect(store.getItem('active')?.status).toBe('active')
  })

  it('honors custom trashRetentionDays', () => {
    const now = 1_000_000
    store.upsertItem(item({
      id: 'week-old',
      title: 'week',
      content: 'c',
      updatedAt: now - 8 * DAY,
    }))
    const purged = runTrashRetentionJob(store, cfg({ trashRetentionDays: 7 }), now)
    expect(purged).toBe(1)
    expect(store.getItem('week-old')).toBeUndefined()
  })
})
