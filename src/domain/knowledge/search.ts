import MiniSearch from 'minisearch'

export type KnowledgeSearchDoc = {
  /** Composite key `spaceId:docId` */
  id: string
  spaceId: string
  docId: string
  title: string
  body: string
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
    storeFields: ['spaceId', 'docId', 'title', 'spaceName', 'path'],
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
  doc: KnowledgeSearchDoc,
): void {
  if (index.has(doc.id)) {
    index.replace(doc)
  } else {
    index.add(doc)
  }
}

export function removeSearchDoc(index: MiniSearch<KnowledgeSearchDoc>, id: string): void {
  if (index.has(id)) index.discard(id)
}

export function searchKnowledge(
  index: MiniSearch<KnowledgeSearchDoc>,
  query: string,
  limit = 30,
): KnowledgeSearchHit[] {
  const q = query.trim()
  if (!q) return []
  return index.search(q).slice(0, limit).map((r) => ({
    spaceId: String(r.spaceId),
    docId: String(r.docId),
    title: String(r.title),
    spaceName: String(r.spaceName),
    path: String(r.path),
    score: r.score,
  }))
}
