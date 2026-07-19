/**
 * Build payloads for the SQLite link index (P0).
 * Resolution uses the same title/alias rules as wiki navigation.
 */

import { matchDocByTitleOrAlias, parseFrontmatter } from './frontmatter'
import { extractOutboundLinks, type ExtractedOutbound } from './linkExtract'
import type { KnowledgeNode } from './types'
import { listDocsInTreeOrder } from './wikiLink'

export type LinkIndexOutbound = {
  kind: 'wiki' | 'embed' | 'md'
  raw: string
  targetTitle: string | null
  targetDocId: string | null
  fragment: string | null
  display: string | null
}

export type LinkIndexDocPayload = {
  docId: string
  title: string
  aliases: string[]
  tags: string[]
  status: string | null
  /** JSON-serializable flat props (P3+); empty object for now */
  props: Record<string, unknown>
  contentHash: string
  updatedAt: number
  outbound: LinkIndexOutbound[]
}

export type LinkIndexBacklink = {
  fromDocId: string
  fromTitle: string
  raw: string
  kind: string
  fragment: string | null
}

export type LinkIndexOutboundRow = LinkIndexOutbound & {
  fromDocId: string
}

/** Cheap stable hash for change detection (not cryptographic). */
export function contentHash(body: string): string {
  let h = 2166136261
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

export function wikiDocsFromNodes(
  nodes: KnowledgeNode[],
  aliasByDocId?: Map<string, string[]>,
): Array<{ id: string; title: string; aliases?: string[]; order?: number }> {
  return listDocsInTreeOrder(nodes).map((d) => ({
    id: d.id,
    title: d.title,
    order: d.order,
    aliases: aliasByDocId?.get(d.id),
  }))
}

/**
 * Resolve outbound targets within a space.
 * Same-doc fragment (`targetTitle === ''`) → targetDocId = fromDocId.
 */
export function resolveOutbound(
  fromDocId: string,
  links: ExtractedOutbound[],
  wikiDocs: Array<{ id: string; title: string; aliases?: string[]; order?: number }>,
): LinkIndexOutbound[] {
  return links.map((l) => {
    if (l.kind === 'md') {
      return {
        kind: 'md',
        raw: l.raw,
        targetTitle: null,
        targetDocId: null,
        fragment: l.fragment,
        display: l.display,
      }
    }
    const title = l.targetTitle ?? ''
    if (title === '' && l.fragment) {
      return {
        kind: l.kind,
        raw: l.raw,
        targetTitle: '',
        targetDocId: fromDocId,
        fragment: l.fragment,
        display: l.display,
      }
    }
    if (!title.trim()) {
      return {
        kind: l.kind,
        raw: l.raw,
        targetTitle: title,
        targetDocId: null,
        fragment: l.fragment,
        display: l.display,
      }
    }
    const hit = matchDocByTitleOrAlias(title, wikiDocs)
    return {
      kind: l.kind,
      raw: l.raw,
      targetTitle: title,
      targetDocId: hit?.id ?? null,
      fragment: l.fragment,
      display: l.display,
    }
  })
}

/** Build one doc payload for upsert/replace_all. */
export function buildDocIndexPayload(
  docId: string,
  title: string,
  body: string,
  nodes: KnowledgeNode[],
  opts?: {
    updatedAt?: number
    aliasByDocId?: Map<string, string[]>
  },
): LinkIndexDocPayload {
  const safeBody = typeof body === 'string' ? body : ''
  const { meta } = parseFrontmatter(safeBody)
  const aliases = meta.aliases.length > 0 ? meta.aliases : (opts?.aliasByDocId?.get(docId) ?? [])
  const wikiDocs = wikiDocsFromNodes(nodes, opts?.aliasByDocId)
  // Ensure current doc title/aliases present for same-space resolve even if tree stale
  const withSelf = wikiDocs.some((d) => d.id === docId)
    ? wikiDocs.map((d) =>
        d.id === docId ? { ...d, title, aliases } : d,
      )
    : [...wikiDocs, { id: docId, title, aliases, order: 0 }]

  const extracted = extractOutboundLinks(safeBody)
  const outbound = resolveOutbound(docId, extracted, withSelf)

  return {
    docId,
    title,
    aliases,
    tags: meta.tags,
    status: meta.status,
    props: {},
    contentHash: contentHash(safeBody),
    updatedAt: opts?.updatedAt ?? Date.now(),
    outbound,
  }
}
