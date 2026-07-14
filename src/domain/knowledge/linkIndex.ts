/**
 * Incremental wiki-link index with composite keys only (P1.4 / PR-13).
 *
 * Keys never use bare docId or bare title:
 * - bySource:     docKey(fromSpace, fromDoc) → edges
 * - byTargetDoc:  docKey(toSpace, toDoc) → edges (resolved only)
 * - byTargetTitle:`${spaceId}::title:${normalizedTitle}` → edges (same-space)
 */

import { matchDocByTitleOrAlias } from './frontmatter'
import { docKey } from './search'
import { extractWikiLinks } from './wikiLink'

/** Skip extract on huge bodies (design: full body under 2MB). */
export const KNOWLEDGE_LINK_EXTRACT_MAX_CHARS = 2_000_000

export type LinkEdge = {
  fromSpaceId: string
  fromDocId: string
  toSpaceId: string | null
  toDocId: string | null
  /** Target title as written in `[[title]]` (trimmed). */
  title: string
  broken: boolean
}

/** Doc identity used for title/alias resolution within a space. */
export type LinkResolveDoc = {
  id: string
  title: string
  aliases?: readonly string[]
  order?: number
}

export type LinkIndex = {
  bySource: Map<string, LinkEdge[]>
  byTargetDoc: Map<string, LinkEdge[]>
  byTargetTitle: Map<string, LinkEdge[]>
}

export function createLinkIndex(): LinkIndex {
  return {
    bySource: new Map(),
    byTargetDoc: new Map(),
    byTargetTitle: new Map(),
  }
}

/** Composite title key — always space-scoped. */
export function titleKey(spaceId: string, title: string): string {
  return `${spaceId}::title:${normalizeTitleKey(title)}`
}

export function normalizeTitleKey(title: string): string {
  return title.trim().toLowerCase()
}

function pushEdge(map: Map<string, LinkEdge[]>, key: string, edge: LinkEdge): void {
  const list = map.get(key)
  if (list) list.push(edge)
  else map.set(key, [edge])
}

function removeEdgeFromList(
  map: Map<string, LinkEdge[]>,
  key: string,
  pred: (e: LinkEdge) => boolean,
): void {
  const list = map.get(key)
  if (!list) return
  const next = list.filter((e) => !pred(e))
  if (next.length === 0) map.delete(key)
  else map.set(key, next)
}

/** Drop all edges whose source is this doc. */
export function removeSourceDoc(
  index: LinkIndex,
  spaceId: string,
  docId: string,
): void {
  const src = docKey(spaceId, docId)
  const edges = index.bySource.get(src)
  if (!edges) return
  index.bySource.delete(src)
  for (const e of edges) {
    if (e.toSpaceId && e.toDocId) {
      removeEdgeFromList(
        index.byTargetDoc,
        docKey(e.toSpaceId, e.toDocId),
        (x) => x.fromSpaceId === spaceId && x.fromDocId === docId && x === e,
      )
    }
    removeEdgeFromList(
      index.byTargetTitle,
      titleKey(spaceId, e.title),
      (x) => x.fromSpaceId === spaceId && x.fromDocId === docId && x === e,
    )
  }
}

/** Drop every edge that touches this space (space delete). */
export function removeSpaceFromLinkIndex(index: LinkIndex, spaceId: string): void {
  for (const [key, edges] of [...index.bySource.entries()]) {
    if (key.startsWith(`${spaceId}:`)) {
      index.bySource.delete(key)
    } else {
      // Outbound edges from other spaces never target foreign spaces (same-space only),
      // but still filter defensively.
      const kept = edges.filter((e) => e.fromSpaceId !== spaceId && e.toSpaceId !== spaceId)
      if (kept.length !== edges.length) {
        if (kept.length === 0) index.bySource.delete(key)
        else index.bySource.set(key, kept)
      }
    }
  }
  for (const [key, edges] of [...index.byTargetDoc.entries()]) {
    if (key.startsWith(`${spaceId}:`)) {
      index.byTargetDoc.delete(key)
      continue
    }
    const kept = edges.filter((e) => e.fromSpaceId !== spaceId && e.toSpaceId !== spaceId)
    if (kept.length !== edges.length) {
      if (kept.length === 0) index.byTargetDoc.delete(key)
      else index.byTargetDoc.set(key, kept)
    }
  }
  for (const [key, edges] of [...index.byTargetTitle.entries()]) {
    if (key.startsWith(`${spaceId}::title:`)) {
      index.byTargetTitle.delete(key)
      continue
    }
    const kept = edges.filter((e) => e.fromSpaceId !== spaceId)
    if (kept.length !== edges.length) {
      if (kept.length === 0) index.byTargetTitle.delete(key)
      else index.byTargetTitle.set(key, kept)
    }
  }
}

/**
 * Replace outbound edges for one source doc.
 * Resolves titles in the same space only (K6), using titles then aliases.
 */
export function indexDocLinks(
  index: LinkIndex,
  spaceId: string,
  docId: string,
  body: string,
  docsInSpace: ReadonlyArray<LinkResolveDoc>,
): void {
  removeSourceDoc(index, spaceId, docId)

  if (!body || body.length > KNOWLEDGE_LINK_EXTRACT_MAX_CHARS) {
    if (body && body.length > KNOWLEDGE_LINK_EXTRACT_MAX_CHARS) {
      // Cheap guard — full extract preferred under 2MB.
      if (typeof console !== 'undefined' && console.debug) {
        console.debug(
          `[knowledge] skip link extract for ${spaceId}:${docId} (${body.length} chars)`,
        )
      }
    }
    return
  }

  const hits = extractWikiLinks(body)
  if (hits.length === 0) return

  const src = docKey(spaceId, docId)
  const edges: LinkEdge[] = []
  // Dedupe identical title targets from one source (count once for UI simplicity).
  const seenTitles = new Set<string>()

  for (const hit of hits) {
    const title = hit.title.trim()
    if (!title) {
      // Empty `[[ ]]` — treat as broken outbound with empty title once.
      const emptyKey = ''
      if (seenTitles.has(emptyKey)) continue
      seenTitles.add(emptyKey)
      const edge: LinkEdge = {
        fromSpaceId: spaceId,
        fromDocId: docId,
        toSpaceId: null,
        toDocId: null,
        title: '',
        broken: true,
      }
      edges.push(edge)
      pushEdge(index.byTargetTitle, titleKey(spaceId, ''), edge)
      continue
    }
    const norm = normalizeTitleKey(title)
    if (seenTitles.has(norm)) continue
    seenTitles.add(norm)

    const match = matchDocByTitleOrAlias(title, docsInSpace)
    // Never treat self-only resolution specially — self-links are valid backlinks targets.
    const edge: LinkEdge = match
      ? {
          fromSpaceId: spaceId,
          fromDocId: docId,
          toSpaceId: spaceId,
          toDocId: match.id,
          title,
          broken: false,
        }
      : {
          fromSpaceId: spaceId,
          fromDocId: docId,
          toSpaceId: null,
          toDocId: null,
          title,
          broken: true,
        }
    edges.push(edge)
    pushEdge(index.byTargetTitle, titleKey(spaceId, title), edge)
    if (edge.toSpaceId && edge.toDocId) {
      pushEdge(index.byTargetDoc, docKey(edge.toSpaceId, edge.toDocId), edge)
    }
  }

  if (edges.length > 0) {
    index.bySource.set(src, edges)
  }
}

/** Docs that link *to* this doc (resolved backlinks). Sorted by fromDocId. */
export function getBacklinks(
  index: LinkIndex,
  spaceId: string,
  docId: string,
): LinkEdge[] {
  const list = index.byTargetDoc.get(docKey(spaceId, docId)) ?? []
  // Copy + stable sort for UI.
  return [...list]
    .filter((e) => !e.broken && e.toDocId === docId)
    .sort((a, b) => {
      const s = a.fromSpaceId.localeCompare(b.fromSpaceId)
      if (s !== 0) return s
      return a.fromDocId.localeCompare(b.fromDocId)
    })
}

/** Outbound broken-link count for a source doc. */
export function countBrokenOutbound(
  index: LinkIndex,
  spaceId: string,
  docId: string,
): number {
  const list = index.bySource.get(docKey(spaceId, docId)) ?? []
  return list.filter((e) => e.broken).length
}

/** All outbound edges from a source doc. */
export function getOutbound(
  index: LinkIndex,
  spaceId: string,
  docId: string,
): LinkEdge[] {
  return [...(index.bySource.get(docKey(spaceId, docId)) ?? [])]
}

/**
 * After titles/aliases change in a space, re-resolve every edge that targets
 * a title key in that space (and re-index each source once).
 * Caller supplies a map of docId → body for all docs that currently have
 * outbound edges in the space (or all docs).
 */
export function reindexSpaceLinks(
  index: LinkIndex,
  spaceId: string,
  docsInSpace: ReadonlyArray<LinkResolveDoc>,
  bodies: ReadonlyMap<string, string>,
): void {
  // Collect sources that either live in this space or already have edges here.
  const sourceIds = new Set<string>()
  for (const d of docsInSpace) sourceIds.add(d.id)
  for (const [key, edges] of index.bySource) {
    if (!key.startsWith(`${spaceId}:`)) continue
    for (const e of edges) sourceIds.add(e.fromDocId)
  }
  for (const docId of sourceIds) {
    const body = bodies.get(docId)
    if (body == null) {
      // Unknown body: drop prior edges so we don't keep stale targets.
      removeSourceDoc(index, spaceId, docId)
      continue
    }
    indexDocLinks(index, spaceId, docId, body, docsInSpace)
  }
}

/**
 * Re-resolve existing outbound edges in a space without re-reading bodies.
 * Use after rename / delete of a *target* so broken flags and byTargetDoc update.
 * Edge titles (as written in markdown) are left unchanged (no auto-rewrite).
 */
export function reresolveSpaceLinks(
  index: LinkIndex,
  spaceId: string,
  docsInSpace: ReadonlyArray<LinkResolveDoc>,
): void {
  const sources: Array<{ docId: string; titles: string[] }> = []
  for (const [key, edges] of index.bySource) {
    if (!key.startsWith(`${spaceId}:`)) continue
    const docId = key.slice(spaceId.length + 1)
    sources.push({ docId, titles: edges.map((e) => e.title) })
  }
  for (const { docId, titles } of sources) {
    removeSourceDoc(index, spaceId, docId)
    const src = docKey(spaceId, docId)
    const rebuilt: LinkEdge[] = []
    const seen = new Set<string>()
    for (const title of titles) {
      const norm = normalizeTitleKey(title)
      if (seen.has(norm)) continue
      seen.add(norm)
      const match = title.trim()
        ? matchDocByTitleOrAlias(title, docsInSpace)
        : null
      const edge: LinkEdge = match
        ? {
            fromSpaceId: spaceId,
            fromDocId: docId,
            toSpaceId: spaceId,
            toDocId: match.id,
            title,
            broken: false,
          }
        : {
            fromSpaceId: spaceId,
            fromDocId: docId,
            toSpaceId: null,
            toDocId: null,
            title,
            broken: true,
          }
      rebuilt.push(edge)
      pushEdge(index.byTargetTitle, titleKey(spaceId, title), edge)
      if (edge.toDocId) {
        pushEdge(index.byTargetDoc, docKey(spaceId, edge.toDocId), edge)
      }
    }
    if (rebuilt.length > 0) index.bySource.set(src, rebuilt)
  }
}

/** Snapshot counts for tests / debug. */
export function linkIndexStats(index: LinkIndex): {
  sources: number
  targetDocs: number
  targetTitles: number
  edges: number
} {
  let edges = 0
  for (const list of index.bySource.values()) edges += list.length
  return {
    sources: index.bySource.size,
    targetDocs: index.byTargetDoc.size,
    targetTitles: index.byTargetTitle.size,
    edges,
  }
}
