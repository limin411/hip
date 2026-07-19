import { describe, expect, it } from 'vitest'
import { EMPTY_DOC_META } from './frontmatter'
import { applyMetaToDocument } from './frontmatterWrite'
import { normalizeSpaceSchema } from './schema'
import {
  boardColumns,
  filterDocRows,
  normalizeViewsFile,
  patchMetaField,
  sortDocRows,
  type DocRow,
} from './views'
import type { KnowledgeNode } from './types'

function row(id: string, title: string, status: string | null, order = 0): DocRow {
  return {
    id,
    title,
    parentId: null,
    order,
    meta: { ...EMPTY_DOC_META, status, tags: status === 'draft' ? ['x'] : [] },
  }
}

describe('normalizeViewsFile / schema', () => {
  it('fills defaults when empty', () => {
    const v = normalizeViewsFile(null)
    expect(v.views.length).toBeGreaterThanOrEqual(2)
    expect(v.views.some((x) => x.layout === 'board')).toBe(true)
  })

  it('normalizes schema builtins', () => {
    const s = normalizeSpaceSchema({ version: 1, properties: [] })
    expect(s.properties.some((p) => p.key === 'status')).toBe(true)
  })
})

describe('filter / sort / board', () => {
  const rows = [
    row('a', 'Alpha', 'draft', 1),
    row('b', 'Beta', 'active', 0),
    row('c', 'Gamma', null, 2),
  ]
  const nodes: KnowledgeNode[] = rows.map((r) => ({
    id: r.id,
    parentId: null,
    kind: 'doc' as const,
    title: r.title,
    order: r.order,
    createdAt: 1,
    updatedAt: 1,
  }))

  it('filters by prop eq', () => {
    const f = filterDocRows(rows, nodes, {
      type: 'prop',
      key: 'status',
      op: 'eq',
      value: 'draft',
    })
    expect(f.map((r) => r.id)).toEqual(['a'])
  })

  it('sorts by title', () => {
    const s = sortDocRows(rows, [{ key: 'title', dir: 'asc' }])
    expect(s.map((r) => r.title)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('boards by status with empty column', () => {
    const cols = boardColumns(rows, 'status', ['draft', 'active', 'done'])
    expect(cols.find((c) => c.key === 'draft')?.rows).toHaveLength(1)
    expect(cols.find((c) => c.key === '')?.rows.map((r) => r.id)).toEqual(['c'])
  })
})

describe('patchMetaField + applyMetaToDocument', () => {
  it('writes status and tags to FM', () => {
    let meta = { ...EMPTY_DOC_META }
    meta = patchMetaField(meta, 'status', 'active')
    meta = patchMetaField(meta, 'tags', ['a', 'b'])
    meta = patchMetaField(meta, 'date', '2026-07-19')
    const doc = applyMetaToDocument('# Hello\n', meta)
    expect(doc).toContain('status: active')
    expect(doc).toContain('tags:')
    expect(doc).toContain('date: 2026-07-19')
    expect(doc).toContain('# Hello')
  })
})
