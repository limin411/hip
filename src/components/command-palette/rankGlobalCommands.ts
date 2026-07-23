/** Shared ranking helpers for the global command palette. */

import { fuzzyMatch } from './fuzzyScore'
import { usageBoost, type CommandUsageMap } from './usageStore'

export type RankableItem = {
  id: string
  label: string
  keywords?: string[]
  description?: string
  /** Additive boost after a match (capped in rankGroups). */
  contextBoost?: number
}

export type RankableGroup<T extends RankableItem = RankableItem> = {
  heading?: string
  id?: string
  items: T[]
}

export type RankOptions = {
  usage?: CommandUsageMap
  now?: number
}

function normalize(s: string): string {
  // Leading `/` is common when users type slash-style names (e.g. `/diff`).
  return s.trim().toLowerCase().replace(/^\/+/, '')
}

/** Score one item: 0 = no match; higher is better. */
export function scoreItem(item: RankableItem, needle: string): number {
  const label = item.label.toLowerCase()
  const keys = (item.keywords ?? []).join(' ').toLowerCase()
  const desc = (item.description ?? '').toLowerCase()
  needle = normalize(needle)
  const terms = needle.split(/\s+/).filter(Boolean)

  const termMissesAll = terms.some(
    (term) => !label.includes(term) && !keys.includes(term) && !desc.includes(term),
  )

  let base = 0
  if (!termMissesAll) {
    if (label === needle) base = 1
    else if (label.startsWith(needle)) base = 0.9
    else {
      const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      if (words.includes(needle)) base = 0.85
      else if (words.some((w) => w.startsWith(needle))) base = 0.8
      else if (label.includes(needle)) base = 0.7
      else if (terms.every((term) => label.includes(term))) base = 0.6
      else if (terms.every((term) => label.includes(term) || keys.includes(term))) base = 0.4
      else if (
        terms.every((term) => label.includes(term) || keys.includes(term) || desc.includes(term))
      ) {
        base = 0.35
      } else {
        base = 0.4
      }
    }
  }

  // Fuzzy subsequence on label (e.g. ssmd → Set Syntax Markdown). Never above 0.65.
  const fuzzy = fuzzyMatch(item.label, needle).score
  return Math.max(base, fuzzy)
}

/** Order items within groups by score; drop non-matches; order groups by best item. */
export function rankGroups<T extends RankableItem>(
  groups: RankableGroup<T>[],
  search: string,
  options?: RankOptions,
): RankableGroup<T>[] {
  const needle = normalize(search)
  if (!needle) return groups

  const usage = options?.usage
  const now = options?.now ?? Date.now()

  return groups
    .map((group) => {
      const scored = group.items
        .map((item) => {
          const base = scoreItem(item, needle)
          if (base <= 0) return { item, score: 0 }
          const usagePart = usage ? usageBoost(usage[item.id], now) : 0
          const ctxPart = Math.min(0.15, Math.max(0, item.contextBoost ?? 0))
          return { item, score: base + usagePart + ctxPart }
        })
        .filter((e) => e.score > 0)
        .sort((a, b) => b.score - a.score)
      return {
        group: { ...group, items: scored.map((e) => e.item) },
        max: scored[0]?.score ?? 0,
      }
    })
    .filter((e) => e.max > 0)
    .sort((a, b) => b.max - a.max)
    .map((e) => e.group)
}
