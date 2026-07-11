import { describe, it, expect, beforeEach } from 'vitest'
import type { MemoryFileConfig, MemoryItem } from '@hip/protocol'
import { MEMORY_FILE_CONFIG_DEFAULTS } from '@hip/protocol'
import { openDatabase } from '../../persistence/open.js'
import { MemoryStore } from '../store.js'
import {
  applyDecayStep,
  isDecayCandidate,
  runDecayJob,
} from './evolution.js'

function cfg(partial: Partial<MemoryFileConfig> = {}): MemoryFileConfig {
  return {
    ...MEMORY_FILE_CONFIG_DEFAULTS,
    maxUnusedDays: 90,
    decayFactor: 0.92,
    forgetConfidence: 0.15,
    ...partial,
  }
}

function loadStore() {
  const { db, memoriesFtsEnabled } = openDatabase(':memory:')
  return new MemoryStore(db, memoriesFtsEnabled)
}

function item(
  partial: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'title' | 'content'>,
): MemoryItem {
  return {
    scope: 'global',
    kind: 'preference',
    confidence: 0.5,
    status: 'active',
    source: 'extract',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    useCount: 0,
    pinned: false,
    ...partial,
  }
}

const DAY = 24 * 60 * 60 * 1000

describe('decay unit', () => {
  it('applyDecayStep multiplies confidence and archives below forgetConfidence', () => {
    const base = item({ id: 'd1', title: 't', content: 'c', confidence: 0.16 })
    const step = applyDecayStep(base, 0.92, 0.15, 1000)
    expect(step.confidence).toBeCloseTo(0.16 * 0.92, 8)
    expect(step.status).toBe('archived')
    expect(step.updatedAt).toBe(1000)

    const higher = applyDecayStep(
      item({ id: 'd2', title: 't', content: 'c', confidence: 0.5 }),
      0.92,
      0.15,
      1000,
    )
    expect(higher.confidence).toBeCloseTo(0.46, 8)
    expect(higher.status).toBe('active')
  })

  it('isDecayCandidate requires extract/consolidate, unpinned, old enough', () => {
    const now = 1_000_000_000_000
    const old = now - 100 * DAY
    expect(
      isDecayCandidate(
        item({ id: 'a', title: 't', content: 'c', source: 'extract', updatedAt: old }),
        now,
        90,
      ),
    ).toBe(true)
    expect(
      isDecayCandidate(
        item({ id: 'b', title: 't', content: 'c', source: 'user', updatedAt: old }),
        now,
        90,
      ),
    ).toBe(false)
    expect(
      isDecayCandidate(
        item({
          id: 'c',
          title: 't',
          content: 'c',
          source: 'consolidate',
          pinned: true,
          updatedAt: old,
        }),
        now,
        90,
      ),
    ).toBe(false)
    expect(
      isDecayCandidate(
        item({ id: 'd', title: 't', content: 'c', source: 'extract', updatedAt: now - 10 * DAY }),
        now,
        90,
      ),
    ).toBe(false)
  })
})

describe('runDecayJob', () => {
  let store: MemoryStore

  beforeEach(() => {
    store = loadStore()
  })

  it('decays old extract items and archives when below threshold', () => {
    const now = Date.now()
    const old = now - 120 * DAY
    store.upsertItem(
      item({
        id: 'old-low',
        title: 'Old low',
        content: 'c',
        confidence: 0.16,
        source: 'extract',
        updatedAt: old,
        createdAt: old,
      }),
    )
    store.upsertItem(
      item({
        id: 'old-high',
        title: 'Old high',
        content: 'c',
        confidence: 0.8,
        source: 'consolidate',
        updatedAt: old,
        createdAt: old,
      }),
    )
    store.upsertItem(
      item({
        id: 'fresh',
        title: 'Fresh',
        content: 'c',
        confidence: 0.16,
        source: 'extract',
        updatedAt: now,
        createdAt: now,
      }),
    )
    store.upsertItem(
      item({
        id: 'user-old',
        title: 'User',
        content: 'c',
        confidence: 0.16,
        source: 'user',
        updatedAt: old,
        createdAt: old,
      }),
    )

    const res = runDecayJob(store, cfg({ decayFactor: 0.92, forgetConfidence: 0.15 }), now)
    expect(res.decayed).toBe(2)
    expect(res.archived).toBe(1)

    expect(store.getItem('old-low')?.status).toBe('archived')
    expect(store.getItem('old-low')?.confidence).toBeCloseTo(0.16 * 0.92, 8)
    expect(store.getItem('old-high')?.status).toBe('active')
    expect(store.getItem('old-high')?.confidence).toBeCloseTo(0.8 * 0.92, 8)
    expect(store.getItem('fresh')?.confidence).toBe(0.16)
    expect(store.getItem('user-old')?.confidence).toBe(0.16)
  })
})
