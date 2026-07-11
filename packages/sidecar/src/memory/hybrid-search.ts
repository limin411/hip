import type { MemoryItem, MemoryModelRef } from '@hip/protocol'
import type { MemoryStore } from './store.js'

export type HybridWeights = {
  alpha: number
  beta: number
  gamma: number
  delta: number
  epsilon: number
}

/** Default hybrid score weights (FTS / cosine / confidence / recency / pin). */
export const DEFAULT_HYBRID_WEIGHTS: HybridWeights = {
  alpha: 0.35,
  beta: 0.4,
  gamma: 0.15,
  delta: 0.05,
  epsilon: 0.05,
}

/** Cosine similarity in [-1, 1]; 0 when either vector is empty or zero-norm. */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export function hybridScore(parts: {
  ftsRankNorm: number // 0..1
  cosineSim: number // 0..1
  confidence: number
  recency: number // exp(-ageDays/30)
  pinned: boolean
  w?: HybridWeights
}): number {
  const w = parts.w ?? DEFAULT_HYBRID_WEIGHTS
  return (
    w.alpha * parts.ftsRankNorm +
    w.beta * parts.cosineSim +
    w.gamma * parts.confidence +
    w.delta * parts.recency +
    w.epsilon * (parts.pinned ? 1 : 0)
  )
}

/**
 * Optional rerank after hybrid scoring.
 * No standard OpenAI-compatible rerank API is wired yet — pass-through keeps
 * hybrid order (top-k already applied). When `rerankModel` is set we log and skip.
 */
export function maybeRerank(
  items: MemoryItem[],
  opts: { rerankModel?: MemoryModelRef; query: string },
): MemoryItem[] {
  if (opts.rerankModel) {
    console.info(
      '[memory] rerankModel set but no clean rerank API; skipping reordering',
      `${opts.rerankModel.providerID}/${opts.rerankModel.modelID}`,
      `queryLen=${opts.query.length}`,
    )
  }
  return items
}

export type SearchHybridOpts = {
  store: MemoryStore
  query: string
  projectKeyHash?: string
  sessionId?: string
  limit: number
  /** null → FTS-only order (no vector rescoring). */
  embedQuery: () => Promise<number[] | null>
  getEmbedding: (id: string) => number[] | null
  now?: number
  weights?: HybridWeights
  /** When set, maybeRerank logs and pass-through (no-op reorder). */
  rerankModel?: MemoryModelRef
}

/**
 * FTS candidate retrieval + optional query embedding + hybrid score reorder.
 * Without a query vector, returns FTS order truncated to `limit`.
 */
export async function searchHybrid(opts: SearchHybridOpts): Promise<MemoryItem[]> {
  const q = opts.query.trim()
  if (!q) return []
  const limit = Math.max(1, opts.limit)
  const ftsHits = opts.store.searchInScopes(q, {
    projectKeyHash: opts.projectKeyHash,
    sessionId: opts.sessionId,
    limit: Math.max(limit * 4, 40),
  })
  if (ftsHits.length === 0) return []

  const qVec = await opts.embedQuery()
  if (!qVec) {
    return maybeRerank(ftsHits.slice(0, limit), {
      rerankModel: opts.rerankModel,
      query: q,
    })
  }

  const now = opts.now ?? Date.now()
  const scored = ftsHits.map((item, idx) => {
    const ftsRankNorm = 1 - idx / Math.max(ftsHits.length, 1)
    const emb = opts.getEmbedding(item.id)
    const cos =
      emb && emb.length === qVec.length ? Math.max(0, cosine(emb, qVec)) : 0
    const ageDays = (now - (item.lastUsedAt ?? item.updatedAt)) / 86_400_000
    const recency = Math.exp(-ageDays / 30)
    return {
      item,
      score: hybridScore({
        ftsRankNorm,
        cosineSim: cos,
        confidence: item.confidence,
        recency,
        pinned: item.pinned,
        w: opts.weights,
      }),
    }
  })
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, limit).map((s) => s.item)
  return maybeRerank(top, { rerankModel: opts.rerankModel, query: q })
}
