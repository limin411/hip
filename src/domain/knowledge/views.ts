/**
 * Collection views (`.hip/views.json`) — filter + layout over docs; MD remains SoT.
 */

import type { KnowledgeDocMeta } from './frontmatter'
import { KNOWLEDGE_TAGS_MAX } from './limits'
import type { KnowledgeNode } from './types'
import { listDocsInTreeOrder } from './wikiLink'
import { isUnderSubtree } from './tree'

export type ViewFilter =
  | { type: 'all' }
  | { type: 'folder'; folderId: string }
  | { type: 'tag'; tag: string }
  | { type: 'prop'; key: string; op: 'eq' | 'set'; value?: string }

export type ViewSort = { key: string; dir: 'asc' | 'desc' }

export type CollectionView = {
  id: string
  name: string
  filter: ViewFilter
  layout: 'table' | 'board'
  columns?: string[]
  sort?: ViewSort[]
  /** Board group key — must be select-type in schema. Default status. */
  boardGroupKey?: string
  boardColumnOrder?: string[]
}

export type ViewsFileV1 = {
  version: 1
  views: CollectionView[]
}

export const DEFAULT_VIEWS: ViewsFileV1 = {
  version: 1,
  views: [
    {
      id: 'view_all_table',
      name: 'All',
      filter: { type: 'all' },
      layout: 'table',
      columns: ['status', 'tags', 'date', 'priority'],
      sort: [{ key: 'title', dir: 'asc' }],
    },
    {
      id: 'view_status_board',
      name: 'Board',
      filter: { type: 'all' },
      layout: 'board',
      boardGroupKey: 'status',
      boardColumnOrder: ['draft', 'active', 'done'],
    },
  ],
}

export function normalizeViewsFile(raw: unknown): ViewsFileV1 {
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_VIEWS)
  const o = raw as { views?: unknown }
  if (!Array.isArray(o.views) || o.views.length === 0) {
    return structuredClone(DEFAULT_VIEWS)
  }
  const views: CollectionView[] = []
  for (const v of o.views) {
    if (!v || typeof v !== 'object') continue
    const r = v as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : `view_${views.length}`
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'View'
    const layout = r.layout === 'board' ? 'board' : 'table'
    const filter = normalizeFilter(r.filter)
    const view: CollectionView = { id, name, filter, layout }
    if (Array.isArray(r.columns)) {
      view.columns = r.columns.filter((c): c is string => typeof c === 'string')
    }
    if (Array.isArray(r.sort)) {
      view.sort = r.sort
        .filter((s): s is ViewSort => {
          if (!s || typeof s !== 'object') return false
          const x = s as ViewSort
          return typeof x.key === 'string' && (x.dir === 'asc' || x.dir === 'desc')
        })
        .map((s) => ({ key: s.key, dir: s.dir }))
    }
    if (typeof r.boardGroupKey === 'string') view.boardGroupKey = r.boardGroupKey
    if (Array.isArray(r.boardColumnOrder)) {
      view.boardColumnOrder = r.boardColumnOrder.filter(
        (c): c is string => typeof c === 'string',
      )
    }
    views.push(view)
  }
  return views.length > 0 ? { version: 1, views } : structuredClone(DEFAULT_VIEWS)
}

function normalizeFilter(f: unknown): ViewFilter {
  if (!f || typeof f !== 'object') return { type: 'all' }
  const r = f as Record<string, unknown>
  if (r.type === 'folder' && typeof r.folderId === 'string') {
    return { type: 'folder', folderId: r.folderId }
  }
  if (r.type === 'tag' && typeof r.tag === 'string') {
    return { type: 'tag', tag: r.tag }
  }
  if (r.type === 'prop' && typeof r.key === 'string') {
    return {
      type: 'prop',
      key: r.key,
      op: r.op === 'set' ? 'set' : 'eq',
      value: typeof r.value === 'string' ? r.value : undefined,
    }
  }
  return { type: 'all' }
}

export type DocRow = {
  id: string
  title: string
  parentId: string | null
  order: number
  meta: KnowledgeDocMeta
}

export function collectDocRows(
  nodes: KnowledgeNode[],
  metaByDocId: Map<string, KnowledgeDocMeta>,
): DocRow[] {
  return listDocsInTreeOrder(nodes).map((d) => ({
    id: d.id,
    title: d.title,
    parentId: d.parentId,
    order: d.order,
    meta: metaByDocId.get(d.id) ?? {
      tags: [],
      status: null,
      aliases: [],
      date: null,
      priority: null,
      icon: null,
      props: {},
    },
  }))
}

export function filterDocRows(
  rows: DocRow[],
  nodes: KnowledgeNode[],
  filter: ViewFilter,
): DocRow[] {
  switch (filter.type) {
    case 'all':
      return rows
    case 'folder':
      return rows.filter(
        (r) =>
          r.parentId === filter.folderId ||
          isUnderSubtree(nodes, filter.folderId, r.id),
      )
    case 'tag': {
      const t = filter.tag.toLowerCase()
      return rows.filter((r) => r.meta.tags.some((x) => x.toLowerCase() === t))
    }
    case 'prop': {
      return rows.filter((r) => {
        const v = getMetaProp(r.meta, filter.key)
        if (filter.op === 'set') return v != null && String(v).length > 0
        return String(v ?? '').toLowerCase() === String(filter.value ?? '').toLowerCase()
      })
    }
    default:
      return rows
  }
}

export function getMetaProp(
  meta: KnowledgeDocMeta,
  key: string,
): string | number | boolean | string[] | null {
  if (key === 'tags') return meta.tags
  if (key === 'status') return meta.status
  if (key === 'aliases') return meta.aliases
  if (key === 'date') return meta.date
  if (key === 'priority') return meta.priority
  const p = meta.props[key]
  return p === undefined ? null : p
}

export function sortDocRows(rows: DocRow[], sort?: ViewSort[]): DocRow[] {
  if (!sort || sort.length === 0) {
    return [...rows].sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order
      return a.title.localeCompare(b.title)
    })
  }
  return [...rows].sort((a, b) => {
    for (const s of sort) {
      let cmp = 0
      if (s.key === 'title') {
        cmp = a.title.localeCompare(b.title)
      } else if (s.key === 'order') {
        cmp = a.order - b.order
      } else {
        const av = getMetaProp(a.meta, s.key)
        const bv = getMetaProp(b.meta, s.key)
        cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, {
          numeric: true,
        })
      }
      if (cmp !== 0) return s.dir === 'desc' ? -cmp : cmp
    }
    return a.id.localeCompare(b.id)
  })
}

export function boardColumns(
  rows: DocRow[],
  groupKey: string,
  columnOrder?: string[],
): Array<{ key: string; label: string; rows: DocRow[] }> {
  const groups = new Map<string, DocRow[]>()
  const emptyKey = ''
  for (const r of rows) {
    const raw = getMetaProp(r.meta, groupKey)
    const k =
      raw == null || raw === ''
        ? emptyKey
        : Array.isArray(raw)
          ? raw[0] ?? emptyKey
          : String(raw)
    const list = groups.get(k) ?? []
    list.push(r)
    groups.set(k, list)
  }
  const order = columnOrder ?? []
  const keys: string[] = []
  for (const k of order) {
    if (groups.has(k)) keys.push(k)
  }
  for (const k of groups.keys()) {
    if (!keys.includes(k)) keys.push(k)
  }
  // empty column last if present
  if (keys.includes(emptyKey)) {
    keys.splice(keys.indexOf(emptyKey), 1)
    keys.push(emptyKey)
  }
  return keys.map((key) => ({
    key,
    label: key === emptyKey ? '(empty)' : key,
    rows: groups.get(key) ?? [],
  }))
}

/** Apply a select/string field change onto meta. */
export function patchMetaField(
  meta: KnowledgeDocMeta,
  key: string,
  value: string | string[] | null,
): KnowledgeDocMeta {
  const next: KnowledgeDocMeta = {
    ...meta,
    tags: [...meta.tags],
    aliases: [...meta.aliases],
    props: { ...meta.props },
  }
  if (key === 'status') {
    next.status = typeof value === 'string' && value ? value : null
  } else if (key === 'date') {
    next.date = typeof value === 'string' && value ? value : null
  } else if (key === 'priority') {
    next.priority = typeof value === 'string' && value ? value : null
  } else if (key === 'icon') {
    next.icon = typeof value === 'string' && value ? value : null
  } else if (key === 'tags') {
    const list = Array.isArray(value) ? value : value ? [value] : []
    next.tags = list.slice(0, KNOWLEDGE_TAGS_MAX)
  } else if (key === 'aliases') {
    next.aliases = Array.isArray(value) ? value : value ? [value] : []
  } else if (value == null || value === '') {
    delete next.props[key]
  } else {
    next.props[key] = value
  }
  return next
}
