import type { MemoryCitation } from '@hip/protocol'
import type { MemoryStore } from './store.js'

/** Trailing fenced block: ```hip-memory-citations … ``` (optional trailing whitespace). */
const TRAILING_FENCE_RE = /```hip-memory-citations[ \t]*\r?\n([\s\S]*?)```[ \t]*\r?\n?$/

/** Inline citation marker: [mem:id] */
const INLINE_MEM_RE = /\[mem:([^\]]+)\]/g

function isCitation(x: unknown): x is MemoryCitation {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  if (typeof o.memoryId !== 'string' || !o.memoryId.trim()) return false
  if (o.title !== undefined && typeof o.title !== 'string') return false
  if (o.note !== undefined && typeof o.note !== 'string') return false
  return true
}

function parseCitationArray(raw: string): MemoryCitation[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const out: MemoryCitation[] = []
    for (const item of parsed) {
      if (!isCitation(item)) return null
      out.push({
        memoryId: item.memoryId.trim(),
        ...(item.title !== undefined ? { title: item.title } : {}),
        ...(item.note !== undefined ? { note: item.note } : {}),
      })
    }
    return out
  } catch {
    return null
  }
}

/**
 * Parse memory citations from assistant content.
 * Prefer trailing ```hip-memory-citations … ``` fence (JSON array).
 * Secondary: inline [mem:id] when id is in allowedIds.
 * Invalid fence JSON → citations [], content unchanged (fence left as-is).
 * On valid fence → strip only the fence block from content (inline [mem:id] kept).
 */
export function parseMemoryCitations(
  content: string,
  allowedIds?: Set<string>,
): {
  citations: MemoryCitation[]
  strippedContent: string
} {
  let strippedContent = content
  const byId = new Map<string, MemoryCitation>()

  const fenceMatch = content.match(TRAILING_FENCE_RE)
  if (fenceMatch) {
    const parsed = parseCitationArray(fenceMatch[1].trim())
    if (parsed !== null) {
      const before = content.slice(0, fenceMatch.index ?? 0)
      strippedContent = before.replace(/\s*$/, '')
      for (const c of parsed) {
        byId.set(c.memoryId, c)
      }
    }
  }

  if (allowedIds && allowedIds.size > 0) {
    INLINE_MEM_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = INLINE_MEM_RE.exec(content)) !== null) {
      const id = m[1].trim()
      if (!id || !allowedIds.has(id)) continue
      if (!byId.has(id)) {
        byId.set(id, { memoryId: id })
      }
    }
  }

  return {
    citations: [...byId.values()],
    strippedContent,
  }
}

/** Increment use_count + last_used_at once per id (deduped). */
export function bumpMemoryUseCounts(store: MemoryStore, ids: Iterable<string>): void {
  const seen = new Set<string>()
  for (const id of ids) {
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    store.incrementUse(trimmed)
  }
}
