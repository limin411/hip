import MiniSearch from 'minisearch'
import { KNOWLEDGE_INDEX_BODY_CHARS } from './limits'
import {
  metaToSearchFields,
  parseFrontmatter,
  type KnowledgeDocMeta,
} from './frontmatter'

export type KnowledgeSearchDoc = {
  /** Composite key `spaceId:docId` */
  id: string
  spaceId: string
  docId: string
  title: string
  /**
   * Indexable body: frontmatter stripped, then length-capped.
   * Callers may pass raw markdown; `upsertSearchDoc` strips FM.
   */
  body: string
  /** Capped body-without-FM for hit snippets (storeFields). */
  bodyPreview: string
  /** Space-joined tags for FTS. */
  tags: string
  status: string
  /** Space-joined aliases for FTS. */
  aliases: string
  spaceName: string
  path: string
  /** Structured meta for filters / wiki (storeFields only). */
  tagList: string[]
  statusValue: string
  aliasList: string[]
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
  tags?: string[]
  status?: string | null
}

/** Hits for one space, in original score order. */
export type KnowledgeSearchHitGroup = {
  spaceId: string
  spaceName: string
  hits: KnowledgeSearchHit[]
}

export const BODY_PREVIEW_CAP = 2048

export function capBodyPreview(body: string, cap = BODY_PREVIEW_CAP): string {
  if (body.length <= cap) return body
  return body.slice(0, cap)
}

/** Cap body length for MiniSearch indexing (large-doc guard). */
export function capIndexBody(body: string, cap = KNOWLEDGE_INDEX_BODY_CHARS): string {
  if (body.length <= cap) return body
  return body.slice(0, cap)
}

/**
 * Group flat hits by space, preserving first-seen space order and score order within each group.
 */
export function groupSearchHitsBySpace(hits: KnowledgeSearchHit[]): KnowledgeSearchHitGroup[] {
  const order: string[] = []
  const map = new Map<string, KnowledgeSearchHitGroup>()
  for (const hit of hits) {
    let group = map.get(hit.spaceId)
    if (!group) {
      group = { spaceId: hit.spaceId, spaceName: hit.spaceName, hits: [] }
      map.set(hit.spaceId, group)
      order.push(hit.spaceId)
    }
    group.hits.push(hit)
  }
  return order.map((id) => map.get(id)!)
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
    fields: ['title', 'body', 'spaceName', 'path', 'tags', 'status', 'aliases'],
    storeFields: [
      'spaceId',
      'docId',
      'title',
      'spaceName',
      'path',
      'bodyPreview',
      'tagList',
      'statusValue',
      'aliasList',
    ],
    tokenize: tokenizeKnowledge,
    searchOptions: {
      boost: {
        title: 3,
        path: 1.5,
        spaceName: 1.2,
        tags: 2,
        status: 1.5,
        aliases: 2,
        body: 1,
      },
      // Fuzzy hurts single-char CJK queries; keep off by default.
      prefix: true,
    },
  })
}

/** Side map for facets + wiki alias resolution (swapped with the MiniSearch index). */
export type KnowledgeDocMetaEntry = {
  spaceId: string
  docId: string
  title: string
  spaceName: string
  path: string
  tags: string[]
  status: string | null
  aliases: string[]
}

export type KnowledgeSearchFacets = {
  tags: string[]
  statuses: string[]
}

/** Build indexable fields from raw markdown (strips frontmatter from body). */
export function prepareSearchContent(rawBody: string): {
  bodyWithoutFm: string
  body: string
  bodyPreview: string
  meta: KnowledgeDocMeta
  tags: string
  status: string
  aliases: string
  tagList: string[]
  statusValue: string
  aliasList: string[]
} {
  const { meta, bodyWithoutFm } = parseFrontmatter(rawBody)
  const fields = metaToSearchFields(meta)
  return {
    bodyWithoutFm,
    body: capIndexBody(bodyWithoutFm),
    bodyPreview: capBodyPreview(bodyWithoutFm),
    meta,
    tags: fields.tags,
    status: fields.status,
    aliases: fields.aliases,
    tagList: meta.tags,
    statusValue: meta.status ?? '',
    aliasList: meta.aliases,
  }
}

export function upsertSearchDoc(
  index: MiniSearch<KnowledgeSearchDoc>,
  doc: Omit<
    KnowledgeSearchDoc,
    'bodyPreview' | 'tags' | 'status' | 'aliases' | 'tagList' | 'statusValue' | 'aliasList'
  > & {
    body: string
    bodyPreview?: string
    tags?: string
    status?: string
    aliases?: string
    tagList?: string[]
    statusValue?: string
    aliasList?: string[]
    /** When provided, records structured meta for facets / wiki (by doc id). */
    metaSink?: Map<string, KnowledgeDocMetaEntry>
  },
): void {
  const prepared = prepareSearchContent(doc.body)
  const full: KnowledgeSearchDoc = {
    id: doc.id,
    spaceId: doc.spaceId,
    docId: doc.docId,
    title: doc.title,
    spaceName: doc.spaceName,
    path: doc.path,
    body: prepared.body,
    bodyPreview: doc.bodyPreview ?? prepared.bodyPreview,
    tags: doc.tags ?? prepared.tags,
    status: doc.status ?? prepared.status,
    aliases: doc.aliases ?? prepared.aliases,
    tagList: doc.tagList ?? prepared.tagList,
    statusValue: doc.statusValue ?? prepared.statusValue,
    aliasList: doc.aliasList ?? prepared.aliasList,
  }
  if (index.has(full.id)) {
    index.replace(full)
  } else {
    index.add(full)
  }
  if (doc.metaSink) {
    doc.metaSink.set(full.id, {
      spaceId: full.spaceId,
      docId: full.docId,
      title: full.title,
      spaceName: full.spaceName,
      path: full.path,
      tags: full.tagList,
      status: full.statusValue ? full.statusValue : null,
      aliases: full.aliasList,
    })
  }
}

export function removeSearchDoc(
  index: MiniSearch<KnowledgeSearchDoc>,
  id: string,
  metaSink?: Map<string, KnowledgeDocMetaEntry>,
): void {
  if (index.has(id)) index.discard(id)
  metaSink?.delete(id)
}

/** Unique tags/statuses sorted (case-insensitive), original spelling of first seen. */
export function collectSearchFacets(
  meta: Map<string, KnowledgeDocMetaEntry>,
): KnowledgeSearchFacets {
  const tagFirst = new Map<string, string>()
  const statusFirst = new Map<string, string>()
  for (const entry of meta.values()) {
    for (const t of entry.tags) {
      const k = t.toLowerCase()
      if (!tagFirst.has(k)) tagFirst.set(k, t)
    }
    if (entry.status) {
      const k = entry.status.toLowerCase()
      if (!statusFirst.has(k)) statusFirst.set(k, entry.status)
    }
  }
  const tags = [...tagFirst.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  )
  const statuses = [...statusFirst.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  )
  return { tags, statuses }
}

export function filterHitsByMeta(
  hits: KnowledgeSearchHit[],
  opts: { tag?: string | null; status?: string | null },
): KnowledgeSearchHit[] {
  const tag = opts.tag?.trim().toLowerCase() || null
  const status = opts.status?.trim().toLowerCase() || null
  if (!tag && !status) return hits
  return hits.filter((h) => {
    if (tag) {
      const tags = h.tags ?? []
      if (!tags.some((t) => t.toLowerCase() === tag)) return false
    }
    if (status) {
      const s = h.status?.toLowerCase() ?? ''
      if (s !== status) return false
    }
    return true
  })
}

/** List docs from the meta map that match tag/status filters (stable map iteration order). */
export function listDocsByMeta(
  meta: Map<string, KnowledgeDocMetaEntry>,
  opts: { tag?: string | null; status?: string | null },
): KnowledgeSearchHit[] {
  const tag = opts.tag?.trim().toLowerCase() || null
  const status = opts.status?.trim().toLowerCase() || null
  if (!tag && !status) return []
  const hits: KnowledgeSearchHit[] = []
  for (const entry of meta.values()) {
    if (tag && !entry.tags.some((t) => t.toLowerCase() === tag)) continue
    if (status && (entry.status?.toLowerCase() ?? '') !== status) continue
    hits.push({
      spaceId: entry.spaceId,
      docId: entry.docId,
      title: entry.title,
      spaceName: entry.spaceName,
      path: entry.path,
      score: 0,
      tags: entry.tags,
      status: entry.status,
    })
  }
  return hits
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
    const tagList = Array.isArray(r.tagList) ? (r.tagList as string[]) : []
    const statusValue = String(r.statusValue ?? '')
    return {
      spaceId: String(r.spaceId),
      docId: String(r.docId),
      title: String(r.title),
      spaceName: String(r.spaceName),
      path: String(r.path),
      score: r.score,
      ...(snippet ? { snippet } : {}),
      ...(tagList.length ? { tags: tagList } : {}),
      ...(statusValue ? { status: statusValue } : { status: null }),
    }
  })
}
