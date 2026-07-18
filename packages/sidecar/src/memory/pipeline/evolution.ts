import type { MemoryFileConfig, MemoryItem } from '@hip/protocol'
import type { MemoryStore } from '../store.js'

const DAY_MS = 24 * 60 * 60 * 1000

export type DecayJobResult = {
  scanned: number
  decayed: number
  archived: number
}

/**
 * Age basis for unused detection: last_used_at if set, else updated_at.
 */
export function itemUnusedAgeMs(item: MemoryItem, now: number): number {
  const base = item.lastUsedAt ?? item.updatedAt
  return now - base
}

/**
 * Whether an item is a decay candidate (source extract|consolidate, unpinned, active, old enough).
 */
export function isDecayCandidate(
  item: MemoryItem,
  now: number,
  maxUnusedDays: number,
): boolean {
  if (item.status !== 'active') return false
  if (item.pinned) return false
  if (item.source !== 'extract' && item.source !== 'consolidate') return false
  const maxMs = maxUnusedDays * DAY_MS
  return itemUnusedAgeMs(item, now) >= maxMs
}

/**
 * Apply one decay step: confidence *= decayFactor; archive if < forgetConfidence.
 * Returns the updated fields (does not write).
 */
export function applyDecayStep(
  item: MemoryItem,
  decayFactor: number,
  forgetConfidence: number,
  now: number,
): Pick<MemoryItem, 'confidence' | 'status' | 'updatedAt'> {
  const confidence = item.confidence * decayFactor
  const status = confidence < forgetConfidence ? 'archived' : item.status
  return { confidence, status, updatedAt: now }
}

/**
 * Decay job: for extract/consolidate unpinned items older than maxUnusedDays,
 * multiply confidence by decayFactor; archive when below forgetConfidence.
 */
export function runDecayJob(
  store: MemoryStore,
  config: MemoryFileConfig,
  now: number = Date.now(),
): DecayJobResult {
  const decayFactor = config.decayFactor ?? 0.92
  const forgetConfidence = config.forgetConfidence ?? 0.15
  const maxUnusedDays = config.maxUnusedDays ?? 90

  const candidates = store.listItems({
    status: 'active',
    source: ['extract', 'consolidate'],
    pinned: false,
    limit: 10_000,
  })

  let scanned = 0
  let decayed = 0
  let archived = 0

  for (const item of candidates) {
    // Profile memories are stable user prefs — never auto-decay.
    if (item.kind === 'profile') continue
    if (!isDecayCandidate(item, now, maxUnusedDays)) continue
    scanned += 1
    const next = applyDecayStep(item, decayFactor, forgetConfidence, now)
    store.upsertItem({
      ...item,
      confidence: next.confidence,
      status: next.status,
      updatedAt: next.updatedAt,
    })
    decayed += 1
    if (next.status === 'archived') archived += 1
  }

  return { scanned, decayed, archived }
}
