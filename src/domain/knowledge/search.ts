import MiniSearch from 'minisearch'

export type KnowledgeSearchDoc = {
  /** Composite key `spaceId:docId` */
  id: string
  spaceId: string
  docId: string
  title: string
  body: string
  /** Capped body for hit snippets (storeFields); full body still indexed for FTS. */
  bodyPreview: string
  spaceName: string
  path: string
}

export type KnowledgeSearchHit = {
  spaceId: string
  docId: string
  title: string
  spaceName: string
  path: string
  score: number
  /** Optional excerpt for UI; omitted when empty. */
  snippet?: string
}

export const BODY_PREVIEW_CAP = 2048

export function capBodyPreview(body: string, cap = BODY_PREVIEW_CAP): string {
  if (body.length <= cap) return body
  return body.slice(0, cap)
}

export function docKey(spaceId: string, docId: string): string {
  return `${spaceId}:${docId}`
}

export function parseDocKey(id: string): { spaceId: string; docId: string } | null {
  const i = id.indexOf(':')
  if (i <= 0) return null
  return { spaceId: id.slice(0, i), docId: id.slice(i + 1) }
}

/** Latin words + individual CJK characters so Chinese titles/body are searchable. */
export function tokenizeKnowledge(text: string): string[] {
  const tokens: string[] = []
  const lower = text.toLowerCase()
  const latin = lower.match(/[a-z0-9_]+/g)
  if (latin) tokens.push(...latin)
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(ch)) {
      tokens.push(ch)
    }
  }
  return tokens
}

export function createKnowledgeIndex(): MiniSearch<KnowledgeSearchDoc> {
  return new MiniSearch<KnowledgeSearchDoc>({
    fields: ['title', 'body', 'spaceName', 'path'],
    storeFields: ['spaceId', 'docId', 'title', 'spaceName', 'path', 'bodyPreview'],
    tokenize: tokenizeKnowledge,
    searchOptions: {
      boost: { title: 3, path: 1.5, spaceName: 1.2, body: 1 },
      // Fuzzy hurts single-char CJK queries; keep off by default.
      prefix: true,
    },
  })
}

export function upsertSearchDoc(
  index: MiniSearch<KnowledgeSearchDoc>,
  doc: Omit<KnowledgeSearchDoc, 'bodyPreview'> & { bodyPreview?: string },
): void {
  const full: KnowledgeSearchDoc = {
    ...doc,
    bodyPreview: doc.bodyPreview ?? capBodyPreview(doc.body),
  }
  if (index.has(full.id)) {
    index.replace(full)
  } else {
    index.add(full)
  }
}

export function removeSearchDoc(index: MiniSearch<KnowledgeSearchDoc>, id: string): void {
  if (index.has(id)) index.discard(id)
}

/** Window around first case-insensitive query match; ~40 chars each side. */
export function windowAroundQuery(text: string, query: string, radius = 40): string | null {
  const q = query.trim()
  if (!q || !text) return null
  const lower = text.toLowerCase()
  const qi = lower.indexOf(q.toLowerCase())
  if (qi < 0) {
    // Try first latin/CJK token
    const tokens = tokenizeKnowledge(q)
    for (const t of tokens) {
      const i = lower.indexOf(t.toLowerCase())
      if (i >= 0) {
        const from = Math.max(0, i - radius)
        const to = Math.min(text.length, i + t.length + radius)
        const slice = text.slice(from, to).replace(/\s+/g, ' ').trim()
        return `${from > 0 ? '…' : ''}${slice}${to < text.length ? '…' : ''}`
      }
    }
    return null
  }
  const from = Math.max(0, qi - radius)
  const to = Math.min(text.length, qi + q.length + radius)
  const slice = text.slice(from, to).replace(/\s+/g, ' ').trim()
  return `${from > 0 ? '…' : ''}${slice}${to < text.length ? '…' : ''}`
}

/**
 * Snippet for UI: query window → leading excerpt → undefined (omit row).
 * Deep matches past bodyPreview cap are best-effort (accepted P2 limit).
 */
export function buildSearchSnippet(bodyPreview: string, query: string): string | undefined {
  if (!bodyPreview) return undefined
  const windowed = windowAroundQuery(bodyPreview, query)
  if (windowed) return windowed
  const lead = bodyPreview.slice(0, 80).replace(/\s+/g, ' ').trim()
  return lead || undefined
}

export function searchKnowledge(
  index: MiniSearch<KnowledgeSearchDoc>,
  query: string,
  limit = 30,
): KnowledgeSearchHit[] {
  const q = query.trim()
  if (!q) return []
  return index.search(q).slice(0, limit).map((r) => {
    const bodyPreview = String(r.bodyPreview ?? '')
    const snippet = buildSearchSnippet(bodyPreview, q)
    return {
      spaceId: String(r.spaceId),
      docId: String(r.docId),
      title: String(r.title),
      spaceName: String(r.spaceName),
      path: String(r.path),
      score: r.score,
      ...(snippet ? { snippet } : {}),
    }
  })
}
